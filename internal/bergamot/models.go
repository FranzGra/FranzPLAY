package bergamot

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/autosubs"
	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/media"
)

// RecordsURL is the list of the models Firefox uses: which versions there
// are, where, and their hashes. No address of a model is written here, so a
// new version comes by itself the next time a model is downloaded.
const RecordsURL = "https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/translations-models/records"

const (
	// partial starts the name of a folder still being downloaded.
	partial = ".partial-"
	// StageModel is the stage of a translation downloading what it needs.
	StageModel = "model"
	// downloadTimeout is the time one file may take: they are 40 MB at most.
	downloadTimeout = 30 * time.Minute
	// maxRecords is the biggest list read; it is some 400 kB.
	maxRecords = 32 << 20
	// tellEvery is how often the pages hear how a download goes.
	tellEvery = 500 * time.Millisecond
)

// The files of a model, by the kind in the list; the names are ours.
var modelFiles = map[string]string{"model": "model.bin", "vocab": "vocab.spm", "lex": "lex.bin"}

// record is one file in the list.
type record struct {
	FromLang   string `json:"fromLang"`
	ToLang     string `json:"toLang"`
	Version    string `json:"version"`
	FileType   string `json:"fileType"`
	Filter     string `json:"filter_expression"`
	Attachment struct {
		Hash     string `json:"hash"`
		Size     int64  `json:"size"`
		Location string `json:"location"`
	} `json:"attachment"`
}

// configFile is the settings of a model for the program: in the new folder, or
// in the old one if it is only there.
func configFile(root content.Root, pair string) string {
	return content.Find(root.TranslatorModels(), root.OldTranslatorModels(), filepath.Join(pair, "config.yml"))
}

// newConfigFile is where the settings of a model being downloaded will be.
func newConfigFile(root content.Root, pair string) string {
	return filepath.Join(root.TranslatorModels(), pair, "config.yml")
}

// Models lists the models on this machine, like "en-it", in order.
func (e *Engine) Models() []string {
	out := []string{}
	for _, dir := range []string{e.root.TranslatorModels(), e.root.OldTranslatorModels()} {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue // none yet
		}
		for _, entry := range entries {
			if !entry.IsDir() || strings.HasPrefix(entry.Name(), partial) {
				continue
			}
			if _, err := os.Stat(filepath.Join(dir, entry.Name(), "config.yml")); err == nil {
				out = append(out, entry.Name())
			}
		}
	}
	slices.Sort(out)
	return slices.Compact(out)
}

// ModelInfo says which models are here and how the download going on goes.
func (e *Engine) ModelInfo() autosubs.ModelInfo {
	info := autosubs.ModelInfo{Have: e.Models(), Files: []autosubs.ModelFile{}}
	for _, pair := range info.Have {
		info.Files = append(info.Files, autosubs.ModelFile{Name: pair, Size: e.modelSize(pair)})
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.now != nil {
		info.Name, info.Done, info.Total = e.now.name, e.now.done, e.now.total
	}
	return info
}

// modelSize adds up the files of a model: what deleting it frees.
func (e *Engine) modelSize(pair string) int64 {
	entries, err := os.ReadDir(filepath.Dir(configFile(e.root, pair)))
	if err != nil {
		return 0
	}
	total := int64(0)
	for _, entry := range entries {
		if info, err := entry.Info(); err == nil {
			total += info.Size()
		}
	}
	return total
}

// DeleteModel deletes a model that is here, and nothing else: the name must
// be among Models. The folder first takes the name of an unfinished download,
// so the model goes all at once, and if the power goes off halfway the rest
// goes with the next download. The caller sees that no job is using it.
func (e *Engine) DeleteModel(pair string) error {
	if !slices.Contains(e.Models(), pair) {
		return fmt.Errorf("delete translation model %q: %w", pair, fs.ErrNotExist)
	}
	for _, root := range []string{e.root.TranslatorModels(), e.root.OldTranslatorModels()} {
		gone := filepath.Join(root, partial+"deleted-"+pair)
		if err := os.RemoveAll(gone); err != nil {
			return fmt.Errorf("delete translation model %s: %w", pair, err)
		}
		err := os.Rename(filepath.Join(root, pair), gone)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return fmt.Errorf("delete translation model %s: %w", pair, err)
		}
		if err := os.RemoveAll(gone); err != nil {
			return fmt.Errorf("delete translation model %s: %w", pair, err)
		}
	}
	e.logger.Info("translation model deleted", "model", pair)
	return nil
}

// download is how the download of a model goes.
type download struct {
	name        string // like "en-it"
	done, total int64  // bytes
}

// Prepare gets the models a translation needs, if they are not here yet. It
// goes on inside the translation's job, so it can be seen and stopped like it.
func (e *Engine) Prepare(ctx context.Context, from, to string) error {
	var missing []string
	for _, pair := range route(from, to) {
		if _, err := os.Stat(configFile(e.root, pair)); errors.Is(err, os.ErrNotExist) {
			missing = append(missing, pair)
		} else if err != nil {
			return fmt.Errorf("translation model %s: %w", pair, err)
		}
	}
	if len(missing) == 0 {
		return nil
	}
	if err := os.MkdirAll(e.root.TranslatorModels(), 0o750); err != nil {
		return fmt.Errorf("translation model: %w", err)
	}
	e.removePartial()
	records, err := e.readRecords(ctx)
	if err != nil {
		return fmt.Errorf("translation model: %w", err)
	}
	for _, pair := range missing {
		if err := e.download(ctx, records, pair); err != nil {
			return fmt.Errorf("translation model %s: %w", pair, err)
		}
	}
	return nil
}

// removePartial removes what a download that stopped halfway has left.
func (e *Engine) removePartial() {
	dirs, err := filepath.Glob(filepath.Join(e.root.TranslatorModels(), partial+"*"))
	if err != nil {
		return
	}
	for _, dir := range dirs {
		if err := os.RemoveAll(dir); err != nil {
			e.logger.Warn("remove unfinished translation model", "error", err)
		}
	}
}

// readRecords reads the list of the models and where their files are.
func (e *Engine) readRecords(ctx context.Context) ([]record, error) {
	var answer struct {
		Data []record `json:"data"`
	}
	if err := e.getJSON(ctx, e.records, &answer); err != nil {
		return nil, fmt.Errorf("list of the models: %w", err)
	}
	return answer.Data, nil
}

// attachments asks the server where it keeps the files: its root says so.
func (e *Engine) attachments(ctx context.Context) (string, error) {
	root, _, ok := strings.Cut(e.records, "/buckets/")
	if !ok {
		return "", fmt.Errorf("odd address %q", e.records)
	}
	var answer struct {
		Capabilities struct {
			Attachments struct {
				BaseURL string `json:"base_url"`
			} `json:"attachments"`
		} `json:"capabilities"`
	}
	if err := e.getJSON(ctx, root+"/", &answer); err != nil {
		return "", fmt.Errorf("address of the models: %w", err)
	}
	if answer.Capabilities.Attachments.BaseURL == "" {
		return "", errors.New("address of the models: the server does not say it")
	}
	return answer.Capabilities.Attachments.BaseURL, nil
}

func (e *Engine) getJSON(ctx context.Context, url string, into any) (err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := e.client.Do(req)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, resp.Body.Close()) }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("answered %d", resp.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, maxRecords)).Decode(into)
}

// plainVersion is a finished version like "2.1": "2.1a1" is one being tried.
var plainVersion = regexp.MustCompile(`^\d+(\.\d+)*$`)

// compareVersions orders versions like "2.1" and "2.10" by their numbers.
func compareVersions(a, b string) int {
	numbers := func(v string) []int {
		var out []int
		for part := range strings.SplitSeq(v, ".") {
			n, err := strconv.Atoi(part)
			if err != nil {
				return out
			}
			out = append(out, n)
		}
		return out
	}
	return slices.Compare(numbers(a), numbers(b))
}

// pick finds the files of the highest finished version of a model that has
// all of them. A pair not on the list will not come by trying again.
func pick(records []record, pair string) ([]record, error) {
	from, to, _ := strings.Cut(pair, "-")
	byVersion := map[string][]record{}
	for _, r := range records {
		if r.FromLang != from || r.ToLang != to || r.Filter != "" || !plainVersion.MatchString(r.Version) {
			continue
		}
		if _, ok := modelFiles[r.FileType]; ok {
			byVersion[r.Version] = append(byVersion[r.Version], r)
		}
	}
	best := ""
	for version, files := range byVersion {
		if len(files) == len(modelFiles) && (best == "" || compareVersions(version, best) > 0) {
			best = version
		}
	}
	if best == "" {
		return nil, fmt.Errorf("%w: no model for %s", media.ErrRefused, pair)
	}
	return byVersion[best], nil
}

// download brings the files of a model into a folder of its own, checks them
// and only then gives it its name: a model that is there is whole.
func (e *Engine) download(ctx context.Context, records []record, pair string) (err error) {
	files, err := pick(records, pair)
	if err != nil {
		return err
	}
	base, err := e.attachments(ctx)
	if err != nil {
		return err
	}
	dir, err := os.MkdirTemp(e.root.TranslatorModels(), partial+"*")
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, os.RemoveAll(dir))
		}
	}()

	total := int64(0)
	for _, f := range files {
		total += f.Attachment.Size
	}
	e.logger.InfoContext(ctx, "translation model download started", "model", pair, "version", files[0].Version, "bytes", total)
	progress := &progress{engine: e, ctx: ctx, name: pair, total: total}
	defer progress.end()
	progress.tell(true)
	for _, f := range files {
		if err := e.fetch(ctx, f, base, filepath.Join(dir, modelFiles[f.FileType]), progress); err != nil {
			return err
		}
	}
	if err := writeConfig(dir, newConfigFile(e.root, pair)); err != nil {
		return err
	}
	if err := os.Rename(dir, filepath.Dir(newConfigFile(e.root, pair))); err != nil {
		return err
	}
	e.logger.InfoContext(ctx, "translation model downloaded", "model", pair)
	return nil
}

// fetch downloads one file and checks it is the one the list describes.
func (e *Engine) fetch(ctx context.Context, f record, base, path string, p *progress) (err error) {
	url := strings.TrimRight(base, "/") + "/" + strings.TrimLeft(f.Attachment.Location, "/")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := e.client.Do(req)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, resp.Body.Close()) }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s answered %d", f.FileType, resp.StatusCode)
	}
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, file.Close()) }()
	hash := sha256.New()
	n, err := io.Copy(io.MultiWriter(file, hash, p), io.LimitReader(resp.Body, f.Attachment.Size+1))
	if err != nil {
		return err
	}
	if got := hex.EncodeToString(hash.Sum(nil)); n != f.Attachment.Size || !strings.EqualFold(got, f.Attachment.Hash) {
		return fmt.Errorf("%s came different from what the list says (%d bytes, hash %s)", f.FileType, n, got)
	}
	return nil
}

// settings are those of the model the program reads, without the paths. The
// program takes one sentence per line (ssplit-mode) and uses one core.
const settings = `beam-size: 1
normalize: 1.0
word-penalty: 0
max-length-break: 128
mini-batch-words: 1024
workspace: 32
max-length-factor: 2.0
skip-cost: true
cpu-threads: 1
quiet: true
quiet-translation: true
gemm-precision: int8shiftAlphaAll
alignment: soft
ssplit-mode: sentence
`

// writeConfig writes the settings in a model's folder dir, with the paths
// its files will have once in place, in the folder of the config.
func writeConfig(dir, config string) error {
	final := filepath.Dir(config)
	path := func(name string) string { return strconv.Quote(filepath.ToSlash(filepath.Join(final, name))) }
	text := "models:\n  - " + path(modelFiles["model"]) +
		"\nvocabs:\n  - " + path(modelFiles["vocab"]) + "\n  - " + path(modelFiles["vocab"]) +
		"\nshortlist:\n  - " + path(modelFiles["lex"]) + "\n  - false\n" + settings
	return os.WriteFile(filepath.Join(dir, filepath.Base(config)), []byte(text), 0o600)
}

// progress counts the bytes of a download and tells how far it is, to the
// job and to the page.
type progress struct {
	engine *Engine
	ctx    context.Context
	name   string
	total  int64
	done   int64
	told   time.Time
}

func (p *progress) Write(b []byte) (int, error) {
	p.done += int64(len(b))
	p.tell(false)
	return len(b), nil
}

func (p *progress) tell(now bool) {
	if !now && time.Since(p.told) < tellEvery {
		return
	}
	p.told = time.Now()
	e := p.engine
	e.mu.Lock()
	e.now = &download{name: p.name, done: p.done, total: p.total}
	e.mu.Unlock()
	jobs.Report(p.ctx, jobs.Progress{Stage: StageModel, Percent: float64(p.done) * 100 / float64(p.total),
		Done: float64(p.done), Total: float64(p.total)})
	if e.changed != nil {
		e.changed()
	}
}

func (p *progress) end() {
	e := p.engine
	e.mu.Lock()
	e.now = nil
	e.mu.Unlock()
	if e.changed != nil {
		e.changed()
	}
}
