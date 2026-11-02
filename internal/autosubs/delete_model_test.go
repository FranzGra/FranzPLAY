package autosubs

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

const (
	deleteWhisper    = "/api/admin/subtitles/models/whisper/"
	deleteTranslator = "/api/admin/subtitles/models/translator/"
)

func (s *site) writeModel(t *testing.T, name, text string) {
	t.Helper()
	if err := os.WriteFile(media.ModelFile(content.Root(s.dataDir), name), []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
}

func (s *site) hasSmall(t *testing.T) bool {
	t.Helper()
	models, err := media.Models(content.Root(s.dataDir))
	if err != nil {
		t.Fatal(err)
	}
	return slices.Contains(models, "small")
}

// fileOf says how the setup describes a whisper model.
func (s *site) fileOf(t *testing.T, name string) ModelFile {
	t.Helper()
	got := decode[Setup](t, s.do(t, "GET", "/api/admin/subtitles/setup", "", http.StatusOK))
	for _, f := range got.ModelFiles {
		if f.Name == name {
			return f
		}
	}
	t.Fatalf("no %s in %+v", name, got.ModelFiles)
	return ModelFile{}
}

func TestDeleteWhisperModel(t *testing.T) {
	s := newSite(t)
	s.writeModel(t, "small", "pretend weights")
	other := media.ModelFile(content.Root(s.dataDir), "medium")
	if f := s.fileOf(t, "small"); f.Size != int64(len("pretend weights")) || f.Busy != "" {
		t.Errorf("before: %+v", f)
	}
	s.do(t, "DELETE", deleteWhisper+"small", "", http.StatusNoContent)
	if s.hasSmall(t) {
		t.Error("the model is still there")
	}
	if _, err := os.Stat(other); err != nil {
		t.Errorf("the other model: %v", err)
	}
	if s.queued != 1 {
		t.Errorf("the pages heard %d times", s.queued)
	}
	got := decode[Setup](t, s.do(t, "GET", "/api/admin/subtitles/setup", "", http.StatusOK))
	if !slices.Equal(got.Models, []string{"medium"}) || len(got.ModelFiles) != 1 {
		t.Errorf("after: %+v %+v", got.Models, got.ModelFiles)
	}
	// Gone: it cannot be deleted twice, nor asked for.
	s.do(t, "DELETE", deleteWhisper+"small", "", http.StatusNotFound)
	id := s.addVideo(t, "film.mkv", "Film")
	s.do(t, "PUT", "/api/admin/subtitles/"+strconv.FormatInt(id, 10), `{"spoken": "it", "model": "small"}`,
		http.StatusBadRequest)
}

func TestDeleteModelRefusesABadName(t *testing.T) {
	s := newSite(t)
	s.opts.Downloader = NewDownloader(content.Root(s.dataDir), "http://unused", func() {}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	outside := filepath.Join(s.dataDir, "precious.bin")
	inside := filepath.Join(content.Root(s.dataDir).WhisperModels(), "ggml-precious.txt")
	silero := filepath.Join(content.Root(s.dataDir).WhisperModels(), "ggml-silero-v5.bin")
	folder := filepath.Join(content.Root(s.dataDir).WhisperModels(), "ggml-folder.bin")
	if err := os.Mkdir(folder, 0o750); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{outside, inside, silero} {
		if err := os.WriteFile(name, []byte("keep"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{
		"tiny",                     // in no list: not here
		"base",                     // offered, but not here
		"..%2Fprecious",            // ../precious
		"..%2F..%2Fprecious",       // ../../precious
		"%2e%2e",                   // the folder above
		"small%2F..%2F..%2Fsmall",  // through a real model
		"silero-v5",                // not a model that writes
		"folder",                   // a folder, not a file
		"small.bin",                // not its name
		"SMALL",                    // not its name
		"precious.txt%00",          // a trick with the end of a string
		strings.Repeat("a", 1<<10), // too long for any name
	} {
		t.Run(name, func(t *testing.T) {
			s.do(t, "DELETE", deleteWhisper+name, "", http.StatusNotFound)
		})
	}
	for _, name := range []string{outside, inside, silero, folder, media.ModelFile(content.Root(s.dataDir), "small")} {
		if _, err := os.Stat(name); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestDeleteModelOnlyAdministrators(t *testing.T) {
	s := newSite(t)
	s.who = users.Account{ID: 2, Name: "Ospite", Role: users.User}
	s.do(t, "DELETE", deleteWhisper+"small", "", http.StatusForbidden)
	s.who = users.Account{}
	s.do(t, "DELETE", deleteWhisper+"small", "", http.StatusUnauthorized)
	s.do(t, "DELETE", deleteTranslator+"en-it", "", http.StatusUnauthorized)
	if !s.hasSmall(t) {
		t.Error("the model went")
	}
}

func TestDeleteModelRefusedWhileUsed(t *testing.T) {
	s := newSite(t)
	id := s.addVideo(t, "film.mkv", "Film")
	second := s.addVideo(t, "altro.mkv", "Altro")
	ask := func(video int64) {
		t.Helper()
		s.do(t, "PUT", "/api/admin/subtitles/"+strconv.FormatInt(video, 10), `{"spoken": "it", "model": "small"}`,
			http.StatusNoContent)
	}
	refused := func(word string) {
		t.Helper()
		rec := s.do(t, "DELETE", deleteWhisper+"small", "", http.StatusConflict)
		if !strings.Contains(rec.Body.String(), word) {
			t.Errorf("refusal %s, want %q", rec.Body, word)
		}
		if f := s.fileOf(t, "small"); !strings.Contains(f.Busy, word) {
			t.Errorf("setup says %q, want %q", f.Busy, word)
		}
		if !s.hasSmall(t) {
			t.Fatal("the model went")
		}
	}

	// Waiting: without its model the job could only fail.
	ask(id)
	refused("1 video in coda")
	ask(second)
	refused("2 video in coda")
	// Another model is free.
	s.do(t, "DELETE", deleteWhisper+"medium", "", http.StatusNoContent)

	s.exec(t, `UPDATE jobs SET state = 'running' WHERE video_id = ? AND kind = 'transcribe'`, id)
	refused("Whisper lo sta usando")

	// Taken back while it runs: the jobs table knows nothing, whisper still
	// listens.
	s.exec(t, `DELETE FROM jobs WHERE kind = 'transcribe'`)
	s.opts.ModelInUse = func(name string) bool { return name == "small" }
	refused("Whisper lo sta usando")
	s.opts.ModelInUse = func(string) bool { return false }

	// Failed is not waiting: nothing starts by itself, and the page offers
	// another model.
	ask(id)
	s.exec(t, `UPDATE jobs SET state = 'failed' WHERE video_id = ? AND kind = 'transcribe'`, id)
	if f := s.fileOf(t, "small"); f.Busy != "" {
		t.Errorf("setup says %q", f.Busy)
	}
	s.do(t, "DELETE", deleteWhisper+"small", "", http.StatusNoContent)
}

func TestDeleteModelAndDownloads(t *testing.T) {
	s := newSite(t)
	fx := newSlowFixture(t)
	s.opts.Downloader = fx.d
	s.writeModel(t, "base", "an older copy")
	waitFor(t, "Run", func() bool { return fx.d.Start("base") == nil })
	waitFor(t, "some bytes", func() bool { st := fx.d.Status(); return st != nil && st.Done > 0 })

	// A copy of it is coming: what would the page show at the end?
	rec := s.do(t, "DELETE", deleteWhisper+"base", "", http.StatusConflict)
	if !strings.Contains(rec.Body.String(), "scaricando") {
		t.Errorf("refusal %s", rec.Body)
	}
	// The others are free, and the download goes on.
	s.do(t, "DELETE", deleteWhisper+"medium", "", http.StatusNoContent)
	if st := fx.d.Status(); st.Ended {
		t.Errorf("the download ended: %+v", st)
	}
	if err := fx.d.Cancel(); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the end", func() bool { return fx.d.Status().Ended })

	// Once deleted, the page no more says how its last download went.
	s.do(t, "DELETE", deleteWhisper+"base", "", http.StatusNoContent)
	got := decode[Setup](t, s.do(t, "GET", "/api/admin/subtitles/setup", "", http.StatusOK))
	if got.Download != nil {
		t.Errorf("download %+v", got.Download)
	}
	// And it can come again.
	waitFor(t, "a new start", func() bool { return fx.d.Start("base") == nil })
	waitFor(t, "going", func() bool { return fx.d.Downloading("base") })
	if err := fx.d.Cancel(); err != nil {
		t.Fatal(err)
	}
}

func TestDeletedModelCanBeDownloadedAgain(t *testing.T) {
	const model = "pretend model weights"
	fx := newDownloadFixture(t, map[string]string{"/ggml-small.bin": model},
		[]Model{{Name: "small", sha1: checksum(model)}})
	if err := fx.start(t, "small"); err != nil {
		t.Fatal(err)
	}
	fx.finished(t)

	s := newSite(t)
	s.dataDir, s.opts.Content, s.opts.Downloader = fx.dataDir, content.Root(fx.dataDir), fx.d
	s.do(t, "DELETE", deleteWhisper+"small", "", http.StatusNoContent)
	if _, err := os.Stat(media.ModelFile(content.Root(fx.dataDir), "small")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("after deleting: %v", err)
	}
	if st := fx.d.Status(); st != nil {
		t.Errorf("status after deleting: %+v", st)
	}
	if err := fx.start(t, "small"); err != nil {
		t.Fatal(err)
	}
	if got := fx.finished(t); got.Error != "" {
		t.Errorf("second download: %+v", got)
	}
	if !s.hasSmall(t) {
		t.Error("the model did not come back")
	}
}

// deletingTranslator is a translator that remembers what it was told to delete.
type deletingTranslator struct {
	fakeLanguages
	have    []string
	deleted *[]string
}

func (d deletingTranslator) ModelInfo() ModelInfo {
	info := ModelInfo{Have: d.have, Files: []ModelFile{}}
	for _, name := range d.have {
		info.Files = append(info.Files, ModelFile{Name: name, Size: 36})
	}
	return info
}

func (d deletingTranslator) Route(from, to string) []string {
	if from == "en" || to == "en" {
		return []string{from + "-" + to}
	}
	return []string{from + "-en", "en-" + to}
}

func (d deletingTranslator) DeleteModel(name string) error {
	*d.deleted = append(*d.deleted, name)
	return nil
}

func TestDeleteTranslatorModel(t *testing.T) {
	s := newSite(t)
	s.do(t, "DELETE", deleteTranslator+"en-it", "", http.StatusNotFound) // a translator with no models
	var deleted []string
	engine := deletingTranslator{fakeLanguages{known: []string{"en", "it", "de"}}, []string{"en-it", "it-en", "en-de"}, &deleted}
	s.opts.Translator, s.opts.TranslatorModels = engine, engine

	for _, name := range []string{"de-fr", "..%2Fen-it", "en-it%2F..%2F..", "%2e%2e"} {
		s.do(t, "DELETE", deleteTranslator+name, "", http.StatusNotFound)
	}

	// A translation in queue, from Italian to German, takes two models.
	id := s.addVideo(t, "film.mkv", "Film")
	s.exec(t, `INSERT INTO translation_requests (video_id, source, from_lang, langs, requested_at)
		VALUES (?, 'file', 'it', 'de', 1)`, id)
	s.exec(t, `INSERT INTO jobs (video_id, kind, state, updated_at) VALUES (?, 'translate', 'pending', 1)`, id)
	rec := s.do(t, "DELETE", deleteTranslator+"en-de", "", http.StatusConflict)
	if !strings.Contains(rec.Body.String(), "1 traduzione in coda") {
		t.Errorf("refusal %s", rec.Body)
	}
	got := decode[Setup](t, s.do(t, "GET", "/api/admin/subtitles/setup", "", http.StatusOK))
	for _, f := range got.TranslatorModels.Files {
		if (f.Busy != "") != (f.Name != "en-it") {
			t.Errorf("setup: %+v", f)
		}
	}
	s.exec(t, `UPDATE jobs SET state = 'running' WHERE video_id = ?`, id)
	rec = s.do(t, "DELETE", deleteTranslator+"it-en", "", http.StatusConflict)
	if !strings.Contains(rec.Body.String(), "una traduzione lo sta usando") {
		t.Errorf("refusal %s", rec.Body)
	}
	if len(deleted) != 0 {
		t.Fatalf("deleted %v", deleted)
	}

	// One it does not need goes.
	s.do(t, "DELETE", deleteTranslator+"en-it", "", http.StatusNoContent)
	if !slices.Equal(deleted, []string{"en-it"}) {
		t.Errorf("deleted %v", deleted)
	}
}
