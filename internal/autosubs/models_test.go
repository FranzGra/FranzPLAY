package autosubs

import (
	"context"
	"crypto/sha1" //nolint:gosec // the checksums whisper.cpp publishes are SHA-1
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/media"
)

func checksum(s string) string {
	sum := sha1.Sum([]byte(s)) //nolint:gosec // see the import
	return hex.EncodeToString(sum[:])
}

// downloadFixture is a downloader running against a fake model server.
type downloadFixture struct {
	d       *Downloader
	dataDir string
	stop    func()
}

func newDownloadFixture(t *testing.T, files map[string]string, models []Model) *downloadFixture {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, ok := files[r.URL.Path]
		if !ok {
			http.NotFound(w, r)
			return
		}
		if _, err := io.WriteString(w, body); err != nil {
			t.Error(err)
		}
	}))
	t.Cleanup(srv.Close)
	dataDir := t.TempDir()
	d := NewDownloader(dataDir, srv.URL, func() {}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	d.models = models
	ctx, cancel := context.WithCancel(context.Background())
	var wg sync.WaitGroup
	wg.Go(func() { d.Run(ctx) })
	fx := &downloadFixture{d: d, dataDir: dataDir, stop: func() { cancel(); wg.Wait() }}
	t.Cleanup(fx.stop)
	return fx
}

// start starts a download, waiting for Run to be ready.
func (fx *downloadFixture) start(t *testing.T, name string) error {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		err := fx.d.Start(name)
		if !errors.Is(err, errBusy) || time.Now().After(deadline) {
			return err
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// finished waits for the download to end and returns how it went.
func (fx *downloadFixture) finished(t *testing.T) Download {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if s := fx.d.Status(); s != nil && s.Ended {
			return *s
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("the download did not finish")
	return Download{}
}

func TestDownloadModel(t *testing.T) {
	const model = "pretend model weights"
	fx := newDownloadFixture(t, map[string]string{"/ggml-small.bin": model},
		[]Model{{Name: "small", sha1: checksum(model)}})
	if err := fx.start(t, "small"); err != nil {
		t.Fatal(err)
	}
	got := fx.finished(t)
	if got.Error != "" || got.Done != int64(len(model)) || got.Total != int64(len(model)) {
		t.Errorf("status = %+v", got)
	}
	data, err := os.ReadFile(media.ModelFile(fx.dataDir, "small"))
	if err != nil || string(data) != model {
		t.Errorf("model file = %q, %v", data, err)
	}
	names, err := media.Models(fx.dataDir)
	if err != nil || len(names) != 1 || names[0] != "small" {
		t.Errorf("Models = %v, %v", names, err)
	}
}

func TestDownloadRefusesAWrongFile(t *testing.T) {
	tests := map[string]map[string]string{
		"wrong content": {"/ggml-small.bin": "something else"},
		"not there":     {},
	}
	for name, files := range tests {
		t.Run(name, func(t *testing.T) {
			fx := newDownloadFixture(t, files, []Model{{Name: "small", sha1: checksum("the real one")}})
			if err := fx.start(t, "small"); err != nil {
				t.Fatal(err)
			}
			if got := fx.finished(t); !strings.HasPrefix(got.Error, "Non sono riuscito") {
				t.Errorf("status = %+v", got)
			}
			entries, err := os.ReadDir(filepath.Join(fx.dataDir, media.WhisperDir))
			if err != nil && !errors.Is(err, os.ErrNotExist) {
				t.Fatal(err)
			}
			if len(entries) != 0 {
				t.Errorf("left %d files", len(entries))
			}
		})
	}
}

func TestDownloadUnknownModel(t *testing.T) {
	fx := newDownloadFixture(t, nil, []Model{{Name: "small"}})
	if err := fx.start(t, "../small"); !errors.Is(err, errUnknownModel) {
		t.Errorf("err = %v, want errUnknownModel", err)
	}
}

func TestDownloadCleansUnfinishedWork(t *testing.T) {
	dataDir := t.TempDir()
	dir := filepath.Join(dataDir, media.WhisperDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{".new-123", "ggml-small.bin"} {
		if err := os.WriteFile(filepath.Join(dir, name), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	d := NewDownloader(dataDir, "http://unused", func() {}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	d.Run(ctx)
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "ggml-small.bin" {
		t.Errorf("left %v", entries)
	}
}

func TestModelsHaveChecksums(t *testing.T) {
	for _, m := range Models {
		if len(m.sha1) != 40 || m.Size <= 0 || m.About == "" {
			t.Errorf("model %+v", m)
		}
	}
}

func TestDownloadWithoutInternet(t *testing.T) {
	// A server that answers, sends a little, then stops: like a
	// connection lost halfway.
	stalled := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "1000")
		if _, err := io.WriteString(w, "a little"); err != nil {
			t.Error(err)
		}
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	t.Cleanup(stalled.Close)
	// An address nobody answers on: like no internet at all.
	closed := httptest.NewServer(http.NotFoundHandler())
	closed.Close()

	for name, url := range map[string]string{"stops halfway": stalled.URL, "no server": closed.URL} {
		t.Run(name, func(t *testing.T) {
			dataDir := t.TempDir()
			d := NewDownloader(dataDir, url, func() {}, slog.New(slog.NewTextHandler(io.Discard, nil)))
			d.models = []Model{{Name: "small", sha1: checksum("the real one")}}
			d.stall = 50 * time.Millisecond
			ctx, cancel := context.WithCancel(context.Background())
			var wg sync.WaitGroup
			wg.Go(func() { d.Run(ctx) })
			fx := &downloadFixture{d: d, dataDir: dataDir}
			t.Cleanup(func() { cancel(); wg.Wait() })
			if err := fx.start(t, "small"); err != nil {
				t.Fatal(err)
			}
			if got := fx.finished(t); !strings.HasPrefix(got.Error, "Non c'è connessione a internet") {
				t.Errorf("error = %q", got.Error)
			}
			entries, err := os.ReadDir(filepath.Join(dataDir, media.WhisperDir))
			if err != nil && !errors.Is(err, os.ErrNotExist) {
				t.Fatal(err)
			}
			if len(entries) != 0 {
				t.Errorf("left %d files", len(entries))
			}
		})
	}
}
