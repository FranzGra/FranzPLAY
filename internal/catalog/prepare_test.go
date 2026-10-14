package catalog

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/server"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// withPrepare is a site with the prepare route; hurried counts the times
// the queue was woken.
func withPrepare(t *testing.T, hurried *int) *site {
	t.Helper()
	s := newSite(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	ui := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "ui") })
	s.handler = server.New("test", logger, ui, Routes(s.db, s.dataDir, logger),
		PrepareRoutes(s.db, s.dataDir, func() { *hurried++ }, logger))
	return s
}

func (s *site) prepare(t *testing.T, target string, who int64) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, target, nil)
	if who != 0 {
		req = req.WithContext(users.NewContext(req.Context(), users.Account{ID: who}))
	}
	rec := httptest.NewRecorder()
	s.handler.ServeHTTP(rec, req)
	return rec
}

func TestPrepareHurriesTheCopy(t *testing.T) {
	hurried := 0
	s := withPrepare(t, &hurried)
	id := s.addVideo(t, "film.mkv", "film", "", 1, true)
	other := s.addVideo(t, "altro.mkv", "other", "", 1, true)
	if _, err := s.db.Exec(`INSERT INTO jobs (video_id, kind, state, updated_at) VALUES
		(?, 'convert', 'pending', 1), (?, 'convert', 'pending', 1)`, other, id); err != nil {
		t.Fatal(err)
	}

	state := func() copyState {
		t.Helper()
		rec := s.prepare(t, "/api/videos/1/prepare", 0)
		if rec.Code != http.StatusOK {
			t.Fatalf("status %d: %s", rec.Code, rec.Body)
		}
		return decode[prepareResponse](t, rec).State
	}
	if got := state(); got != copyWaiting || hurried != 1 {
		t.Errorf("state %q, woken %d times; want waiting, woken once", got, hurried)
	}
	var next int64
	if err := s.db.QueryRow(`SELECT video_id FROM jobs ORDER BY priority, id LIMIT 1`).Scan(&next); err != nil || next != id {
		t.Errorf("next job is for video %d (%v), want %d", next, err, id)
	}

	if _, err := s.db.Exec(`UPDATE jobs SET state = 'running' WHERE video_id = ?`, id); err != nil {
		t.Fatal(err)
	}
	if got := state(); got != copyWorking {
		t.Errorf("state %q, want working", got)
	}
	// ffmpeg is a third of the way through the 90 seconds.
	dir := filepath.Join(s.dataDir, "converted")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".progress-1.txt"), []byte("out_time_us=30000000\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := decode[prepareResponse](t, s.prepare(t, "/api/videos/1/prepare", 0)); got.Percent == nil || *got.Percent != 33 {
		t.Errorf("answer %+v, want 33 percent", got)
	}
	if _, err := s.db.Exec(`UPDATE jobs SET state = 'failed' WHERE video_id = ?`, id); err != nil {
		t.Fatal(err)
	}
	if got := state(); got != copyWaiting {
		t.Errorf("failed copy asked again: state %q, want waiting", got)
	}
	if _, err := s.db.Exec(`UPDATE jobs SET state = 'done' WHERE video_id = ?;
		UPDATE videos SET converted = '1-fp.mp4' WHERE id = ?`, id, id); err != nil {
		t.Fatal(err)
	}
	woken := hurried
	if got := state(); got != copyReady || hurried != woken {
		t.Errorf("state %q, woken again %v; want ready, not woken", got, hurried != woken)
	}
}

func TestPrepareWithoutACopy(t *testing.T) {
	hurried := 0
	s := withPrepare(t, &hurried)
	s.addVideo(t, "mare.mp4", "sea", "", 1, true)
	if rec := s.prepare(t, "/api/videos/1/prepare", 0); decode[prepareResponse](t, rec).State != copyNone || hurried != 0 {
		t.Errorf("no copy planned: %s, woken %d times", rec.Body, hurried)
	}
}

func TestPrepareOnlyVideosThePersonMayWatch(t *testing.T) {
	hurried := 0
	s := withPrepare(t, &hurried)
	if _, err := s.db.Exec(`INSERT INTO users (name, password_hash, role, created_at) VALUES ('Giulia', 'x', 'user', 1)`); err != nil {
		t.Fatal(err)
	}
	private := s.addVideo(t, "private.mkv", "secret", "", 1, true)
	if _, err := s.db.Exec(`UPDATE videos SET uploaded_by = 1, private = 1 WHERE id = ?;
		INSERT INTO jobs (video_id, kind, state, updated_at) VALUES (?, 'convert', 'pending', 1)`, private, private); err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{"/api/videos/1/prepare", "/api/videos/9/prepare", "/api/videos/x/prepare"} {
		if rec := s.prepare(t, target, 0); rec.Code != http.StatusNotFound {
			t.Errorf("%s by someone else: status %d, want 404", target, rec.Code)
		}
	}
	if hurried != 0 {
		t.Error("queue woken for a video nobody may see")
	}
	if rec := s.prepare(t, "/api/videos/1/prepare", 1); rec.Code != http.StatusOK {
		t.Errorf("Giulia: status %d", rec.Code)
	}
}
