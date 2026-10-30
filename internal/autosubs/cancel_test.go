package autosubs

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/media"
)

// slowFixture is a downloader against a server that sends a big model
// a little at a time, until the test ends.
type slowFixture struct {
	d       *Downloader
	dataDir string
	told    atomic.Int64 // how many times the pages were told
}

func newSlowFixture(t *testing.T) *slowFixture {
	t.Helper()
	done := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(100<<20))
		chunk := make([]byte, 1024)
		for {
			select {
			case <-done:
				return
			case <-time.After(5 * time.Millisecond):
			}
			if _, err := w.Write(chunk); err != nil {
				return // the download was stopped
			}
			w.(http.Flusher).Flush()
		}
	}))
	fx := &slowFixture{dataDir: t.TempDir()}
	fx.d = NewDownloader(fx.dataDir, srv.URL, func() { fx.told.Add(1) }, slog.New(slog.NewTextHandler(io.Discard, nil)))
	fx.d.models = []Model{{Name: "base", sha1: "x"}}
	ctx, cancel := context.WithCancel(context.Background())
	var wg sync.WaitGroup
	wg.Go(func() { fx.d.Run(ctx) })
	t.Cleanup(func() {
		close(done)
		cancel()
		wg.Wait()
		srv.Close()
	})
	return fx
}

// waitFor waits until ok, for at most 5 seconds.
func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("waited too long for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestDownloadCanBeCanceled(t *testing.T) {
	fx := newSlowFixture(t)
	if err := fx.d.Cancel(); err != errNotDownloading {
		t.Errorf("cancel with nothing going on = %v, want errNotDownloading", err)
	}
	waitFor(t, "Run", func() bool { return fx.d.Start("base") == nil })
	waitFor(t, "some bytes", func() bool { s := fx.d.Status(); return s != nil && s.Done > 10<<10 })

	going := fx.d.Status()
	if going.Total != 100<<20 || going.Ended || going.StartedAt.IsZero() || going.EndedAt != nil {
		t.Errorf("while it goes: %+v", going)
	}
	if j := fx.d.Jobs(); len(j) != 1 || j[0].Kind != jobs.ModelDownload || j[0].Title != "base" ||
		j[0].Progress == nil || *j[0].Progress <= 0 || j[0].StartedAt == nil {
		t.Errorf("as work on the queue's page: %+v", j)
	}

	if err := fx.d.Cancel(); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the end", func() bool { s := fx.d.Status(); return s.Ended })
	s := fx.d.Status()
	if !s.Canceled || s.Error != "Download annullato." || s.EndedAt == nil || s.Speed <= 0 {
		t.Errorf("after canceling: %+v", s)
	}
	entries, err := os.ReadDir(filepath.Join(fx.dataDir, media.WhisperDir))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Errorf("left %d files: the half-downloaded model must go", len(entries))
	}
	if err := fx.d.Cancel(); err != errNotDownloading {
		t.Errorf("cancel after the end = %v, want errNotDownloading", err)
	}
	if j := fx.d.Jobs(); len(j) != 0 {
		t.Errorf("an ended download is still work: %+v", j)
	}
	// A new download can start right away.
	waitFor(t, "a new start", func() bool { return fx.d.Start("base") == nil })
}

// TestDownloadTellsOften: the pages hear how a download goes about
// twice a second, not only every 16 MB.
func TestDownloadTellsOften(t *testing.T) {
	fx := newSlowFixture(t)
	waitFor(t, "Run", func() bool { return fx.d.Start("base") == nil })
	time.Sleep(1300 * time.Millisecond)
	// Told at the start, then about every 500 ms: 3 or 4 times in 1.3 s,
	// although only about 250 kB arrived.
	if n := fx.told.Load(); n < 3 || n > 5 {
		t.Errorf("told %d times in 1.3 seconds, want 3-4", n)
	}
	if err := fx.d.Cancel(); err != nil {
		t.Fatal(err)
	}
}

func TestCancelDownloadRoute(t *testing.T) {
	s := newSite(t)
	s.do(t, "DELETE", "/api/admin/subtitles/download", "", http.StatusNotFound) // no downloader
	fx := newSlowFixture(t)
	s.opts.Downloader = fx.d
	s.do(t, "DELETE", "/api/admin/subtitles/download", "", http.StatusConflict) // nothing going on
	waitFor(t, "Run", func() bool { return fx.d.Start("base") == nil })
	waitFor(t, "some bytes", func() bool { s := fx.d.Status(); return s != nil && s.Done > 0 })
	s.do(t, "DELETE", "/api/admin/subtitles/download", "", http.StatusNoContent)
	waitFor(t, "the end", func() bool { return fx.d.Status().Ended })
	got := decode[Setup](t, s.do(t, "GET", "/api/admin/subtitles/setup", "", http.StatusOK))
	if got.Download == nil || !got.Download.Canceled {
		t.Errorf("setup = %+v", got.Download)
	}
}

// TestListShowsTranscriptionProgress: while whisper listens, the page of
// the subtitles gets how far it is.
func TestListShowsTranscriptionProgress(t *testing.T) {
	s := newSite(t)
	id := s.addVideo(t, "film.mkv", "Film")
	s.do(t, "PUT", "/api/admin/subtitles/"+strconv.FormatInt(id, 10), `{"spoken": "it", "model": "small"}`,
		http.StatusNoContent)
	var jobID int64
	if err := s.db.QueryRow(`UPDATE jobs SET state = 'running' WHERE video_id = ? RETURNING id`, id).Scan(&jobID); err != nil {
		t.Fatal(err)
	}
	started := time.Unix(1_800_000_000, 0).UTC()
	s.opts.Running = func() []jobs.Running {
		return []jobs.Running{{ID: jobID, VideoID: id, Kind: jobs.Transcribe, StartedAt: started, Known: true,
			Progress: jobs.Progress{Stage: "transcribe", Percent: 37.5, Done: 45, Total: 120}}}
	}
	got := decode[listAnswer](t, s.do(t, "GET", "/api/admin/subtitles", "", http.StatusOK))
	r := got.Videos[0].Request
	if r == nil || r.State != "running" || r.Progress == nil || *r.Progress != 37.5 || *r.HeardSeconds != 45 ||
		*r.TotalSeconds != 120 || r.StartedAt == nil || !r.StartedAt.Equal(started) {
		t.Errorf("request = %+v", r)
	}

	s.opts.Running = func() []jobs.Running { return nil } // it ended meanwhile
	got = decode[listAnswer](t, s.do(t, "GET", "/api/admin/subtitles", "", http.StatusOK))
	if r := got.Videos[0].Request; r.Progress != nil || r.StartedAt != nil {
		t.Errorf("request = %+v, want no progress", r)
	}
}
