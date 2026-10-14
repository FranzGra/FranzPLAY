package autosubs

import (
	"context"
	"crypto/sha1" //nolint:gosec // the checksums whisper.cpp publishes are SHA-1
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/media"
)

// Model is a whisper model FranzPLAY can download by itself, so nobody
// has to copy files by hand, as with the old FranzPLAY.
type Model struct {
	Name  string `json:"name"`  // "small"
	Size  int64  `json:"size"`  // bytes, about
	About string `json:"about"` // for people
	sha1  string // the checksum whisper.cpp publishes for the file
}

// Models are the models offered, from the lightest. Their checksums come
// from whisper.cpp's models/README.md.
var Models = []Model{
	{"base", 142 << 20, "Veloce, meno preciso. Per computer piccoli.", "465707469ff3a37a2b9b8d8f89f2f99de7299dac"},
	{"small", 466 << 20, "Il giusto mezzo: va bene anche su un Raspberry Pi.", "55356645c2b361a969dfd0ef2c5a50d530afd8d5"},
	{"medium", 1536 << 20, "Più preciso, molto più lento. Serve un computer potente.", "fd9727b6e1217c2f614f9b698455c4ffd82463b4"},
	{"large-v3-turbo-q5_0", 547 << 20, "Il più preciso tra quelli leggeri, per computer potenti.", "e050f7970618a659205450ad97eb95a18d69c9ee"},
}

// ModelsURL is where whisper.cpp's models are downloaded from.
const ModelsURL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main"

// Download is how a model's download goes.
type Download struct {
	Name  string `json:"name"`
	Done  int64  `json:"done"`  // bytes so far
	Total int64  `json:"total"` // bytes in all, 0 = not known yet
	Error string `json:"error"` // why it stopped
	Ended bool   `json:"ended"` // finished, well (Error "") or not
}

// How long the models' server may keep FranzPLAY waiting. Without
// internet, or with a connection that stops halfway, a download ends
// with a clear message instead of waiting forever.
const (
	connectTimeout = 30 * time.Second // to reach the server and get its answer
	stallTimeout   = time.Minute      // with no bytes arriving, halfway through
)

// errStalled means no bytes arrived for stallTimeout.
var errStalled = errors.New("no data for too long")

// errBusy means a download is already going.
var errBusy = errors.New("another model is downloading")

// errUnknownModel means the name is not in Models.
var errUnknownModel = errors.New("unknown model")

// Downloader downloads one model at a time into the whisper folder of
// the data folder. Run does the work; Start asks for it.
type Downloader struct {
	dataDir string
	baseURL string
	client  *http.Client
	logger  *slog.Logger
	changed func() // tells the pages how the download goes
	models  []Model
	stall   time.Duration // stallTimeout, shorter in the tests

	start chan Model
	mu    sync.Mutex
	now   *Download // nil: nothing downloaded since FranzPLAY started
}

// NewDownloader returns a downloader into dataDir/whisper. changed is
// called as the download goes on.
func NewDownloader(dataDir, baseURL string, changed func(), logger *slog.Logger) *Downloader {
	dialer := &net.Dialer{Timeout: connectTimeout}
	client := &http.Client{Transport: &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           dialer.DialContext,
		TLSHandshakeTimeout:   connectTimeout,
		ResponseHeaderTimeout: connectTimeout,
	}}
	return &Downloader{dataDir: dataDir, baseURL: baseURL, client: client, logger: logger,
		changed: changed, models: Models, stall: stallTimeout, start: make(chan Model)}
}

// Status returns how the last download goes or went; nil if none.
func (d *Downloader) Status() *Download {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.now == nil {
		return nil
	}
	s := *d.now
	return &s
}

// Start asks for a model's download. It never waits: if another download
// goes on, or Run is not running, it says so.
func (d *Downloader) Start(name string) error {
	for _, m := range d.models {
		if m.Name != name {
			continue
		}
		select {
		case d.start <- m:
			return nil
		default:
			return errBusy
		}
	}
	return errUnknownModel
}

// Run downloads the models asked, one at a time, until ctx ends. Work
// left half done by an earlier run is deleted first.
func (d *Downloader) Run(ctx context.Context) {
	if err := d.removeUnfinished(); err != nil {
		d.logger.ErrorContext(ctx, "remove unfinished model downloads", "error", err)
	}
	for {
		select {
		case <-ctx.Done():
			return
		case m := <-d.start:
			d.set(Download{Name: m.Name})
			err := d.download(ctx, m)
			if ctx.Err() != nil {
				return
			}
			if err != nil {
				d.logger.ErrorContext(ctx, "download whisper model", "model", m.Name, "error", err)
				d.update(func(s *Download) { s.Error, s.Ended = failure(err), true })
			} else {
				d.logger.InfoContext(ctx, "whisper model downloaded", "model", m.Name)
				d.update(func(s *Download) { s.Ended = true })
			}
			d.changed()
		}
	}
}

// download writes the model to a temporary file, checks it, and only
// then gives it its name (rule 6).
func (d *Downloader) download(parent context.Context, m Model) (err error) {
	// Every byte that arrives pushes the stall timer back.
	ctx, cancel := context.WithCancelCause(parent)
	defer cancel(nil)
	stalled := time.AfterFunc(d.stall, func() { cancel(errStalled) })
	defer stalled.Stop()
	defer func() {
		if errors.Is(context.Cause(ctx), errStalled) {
			err = errors.Join(errStalled, err)
		}
	}()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, d.baseURL+"/ggml-"+m.Name+".bin", nil)
	if err != nil {
		return err
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, resp.Body.Close()) }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("the server answered %d", resp.StatusCode)
	}
	d.update(func(s *Download) { s.Total = max(resp.ContentLength, 0) })

	dir := filepath.Join(d.dataDir, media.WhisperDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".new-*")
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, os.Remove(tmp.Name()))
		}
	}()
	sum := sha1.New() //nolint:gosec // see the import
	_, copyErr := io.Copy(io.MultiWriter(tmp, sum, progress{d, stalled}), resp.Body)
	if err := errors.Join(copyErr, tmp.Close()); err != nil {
		return err
	}
	if got := hex.EncodeToString(sum.Sum(nil)); got != m.sha1 {
		return fmt.Errorf("the file is not the right one (checksum %s)", got)
	}
	return os.Rename(tmp.Name(), media.ModelFile(d.dataDir, m.Name))
}

// failure says to people why a download stopped. Without internet it
// says so, and how to have the model anyway.
func failure(err error) string {
	var dns *net.DNSError
	var op *net.OpError
	switch {
	case errors.Is(err, errStalled), errors.As(err, &dns), errors.As(err, &op), isTimeout(err):
		return "Non c'è connessione a internet, o il server dei modelli non risponde. " +
			"Internet serve solo per scaricare il modello: puoi anche copiarlo tu nella cartella dei modelli."
	default:
		return "Non sono riuscito a scaricarlo: " + err.Error()
	}
}

// isTimeout reports whether err is a network timeout.
func isTimeout(err error) bool {
	var t interface{ Timeout() bool }
	return errors.As(err, &t) && t.Timeout()
}

// progress counts the bytes downloaded.
type progress struct {
	d       *Downloader
	stalled *time.Timer
}

func (p progress) Write(b []byte) (int, error) {
	p.stalled.Reset(p.d.stall)
	tell := false
	p.d.update(func(s *Download) {
		before := s.Done
		s.Done += int64(len(b))
		tell = before>>24 != s.Done>>24 // every 16 MB
	})
	if tell {
		p.d.changed()
	}
	return len(b), nil
}

func (d *Downloader) set(s Download) {
	d.mu.Lock()
	d.now = &s
	d.mu.Unlock()
	d.changed()
}

func (d *Downloader) update(f func(*Download)) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.now != nil {
		f(d.now)
	}
}

// removeUnfinished deletes downloads left half done.
func (d *Downloader) removeUnfinished() error {
	entries, err := os.ReadDir(filepath.Join(d.dataDir, media.WhisperDir))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	var errs []error
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".new-") && e.Type().IsRegular() {
			errs = append(errs, os.Remove(filepath.Join(d.dataDir, media.WhisperDir, e.Name())))
		}
	}
	return errors.Join(errs...)
}
