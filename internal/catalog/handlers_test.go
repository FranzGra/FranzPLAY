package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/server"
)

// site is the whole HTTP handler on a catalog prepared by the test.
type site struct {
	handler http.Handler
	db      *sql.DB
	library string
	dataDir string
}

func newSite(t *testing.T) *site {
	t.Helper()
	dataDir := t.TempDir()
	db, err := database.Open(context.Background(), dataDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	s := &site{db: db, library: t.TempDir(), dataDir: dataDir}
	if _, err := db.Exec(`INSERT INTO libraries (id, path) VALUES (1, ?)`, s.library); err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	ui := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "ui") })
	s.handler = server.New("test", logger, ui, Routes(db, dataDir, logger))
	return s
}

// addVideo puts a file in the library and its row in the catalog.
func (s *site) addVideo(t *testing.T, rel, content, category string, addedAt int64, probed bool) int64 {
	t.Helper()
	name := filepath.Join(s.library, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(name), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	res, err := s.db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, category, added_at)
		VALUES (?, 1, ?, ?, 1, ?, ?, ?)`, "fp-"+rel, rel, len(content), filepath.Base(rel), category, addedAt)
	if err != nil {
		t.Fatal(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if probed {
		if _, err := s.db.Exec(`UPDATE videos SET duration = 90, width = 1280, height = 720,
			video_codec = 'h264', audio_codec = 'aac', container = 'mov,mp4', cover = ? WHERE id = ?`,
			"1-abc.jpg", id); err != nil {
			t.Fatal(err)
		}
	}
	return id
}

func (s *site) get(t *testing.T, target string, header ...string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	for i := 0; i+1 < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	rec := httptest.NewRecorder()
	s.handler.ServeHTTP(rec, req)
	return rec
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.NewDecoder(rec.Body).Decode(&v); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return v
}

func TestListVideos(t *testing.T) {
	s := newSite(t)
	older := s.addVideo(t, "Viaggi/mare.mp4", "sea", "Viaggi", 100, true)
	newer := s.addVideo(t, "prova.mkv", "test", "", 200, false)
	gone := s.addVideo(t, "Viaggi/vecchio.mp4", "old", "Viaggi", 300, false)
	if _, err := s.db.Exec(`UPDATE videos SET missing_since = 1 WHERE id = ?`, gone); err != nil {
		t.Fatal(err)
	}

	rec := s.get(t, "/api/videos")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	got := decode[listResponse](t, rec)
	if got.Total != 2 || len(got.Videos) != 2 || got.Videos[0].ID != newer || got.Videos[1].ID != older {
		t.Fatalf("list = %+v, want the two present videos, newest first", got)
	}

	sea := got.Videos[1]
	if sea.Title != "mare.mp4" || sea.Category != "Viaggi" || *sea.Duration != 90 ||
		*sea.Width != 1280 || *sea.Height != 720 || *sea.Cover != "/api/covers/1-abc.jpg" || !sea.Playable {
		t.Errorf("probed video = %+v", sea)
	}
	notRead := got.Videos[0]
	if notRead.Duration != nil || notRead.Width != nil || notRead.Cover != nil || notRead.Playable {
		t.Errorf("video not read yet = %+v, want null details and not playable", notRead)
	}
}

func TestListVideosByCategoryAndPage(t *testing.T) {
	s := newSite(t)
	for i, rel := range []string{"Viaggi/a.mp4", "Viaggi/b.mp4", "Viaggi/c.mp4", "Corsi/d.mp4"} {
		s.addVideo(t, rel, rel, filepath.Dir(rel), int64(i), false)
	}

	got := decode[listResponse](t, s.get(t, "/api/videos?category=Viaggi&limit=2&offset=1"))
	if got.Total != 3 || len(got.Videos) != 2 || got.Videos[0].Title != "b.mp4" || got.Videos[1].Title != "a.mp4" {
		t.Errorf("page = %+v", got)
	}

	empty := s.get(t, "/api/videos?category=Nessuna")
	if body := empty.Body.String(); body != "{\"videos\":[],\"total\":0}\n" {
		t.Errorf("empty list body = %q, want an empty array", body)
	}

	if rec := s.get(t, "/api/videos?limit=1000"); rec.Code != http.StatusBadRequest {
		t.Errorf("limit=1000: status %d, want 400", rec.Code)
	}
}

func TestGetVideo(t *testing.T) {
	s := newSite(t)
	id := s.addVideo(t, "mare.mp4", "sea", "", 1, true)

	rec := s.get(t, "/api/videos/1")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if v := decode[Video](t, rec); v.ID != id || v.Title != "mare.mp4" {
		t.Errorf("video = %+v", v)
	}
	for _, target := range []string{"/api/videos/999", "/api/videos/abc", "/api/videos/0"} {
		if rec := s.get(t, target); rec.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", target, rec.Code)
		}
	}
}

func TestCategories(t *testing.T) {
	s := newSite(t)
	s.addVideo(t, "viaggi/a.mp4", "a", "viaggi", 1, false)
	s.addVideo(t, "Corsi/b.mp4", "b", "Corsi", 1, false)
	s.addVideo(t, "Corsi/c.mp4", "c", "Corsi", 1, false)
	s.addVideo(t, "d.mp4", "d", "", 1, false)

	got := decode[[]Category](t, s.get(t, "/api/categories"))
	want := []Category{{"Corsi", 2}, {"viaggi", 1}}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("categories = %+v, want %+v", got, want)
	}
}

func TestStreamSupportsJumping(t *testing.T) {
	s := newSite(t)
	s.addVideo(t, "Viaggi/mare.mp4", "0123456789", "Viaggi", 1, true)

	full := s.get(t, "/api/videos/1/stream")
	if full.Code != http.StatusOK || full.Body.String() != "0123456789" {
		t.Fatalf("full file: %d %q", full.Code, full.Body)
	}
	if ct := full.Header().Get("Content-Type"); ct != "video/mp4" {
		t.Errorf("Content-Type = %q", ct)
	}
	if ar := full.Header().Get("Accept-Ranges"); ar != "bytes" {
		t.Errorf("Accept-Ranges = %q, want bytes", ar)
	}

	// The player jumps ahead: it asks only for bytes 3 to 6.
	part := s.get(t, "/api/videos/1/stream", "Range", "bytes=3-6")
	if part.Code != http.StatusPartialContent || part.Body.String() != "3456" {
		t.Errorf("range: %d %q, want 206 \"3456\"", part.Code, part.Body)
	}
	if cr := part.Header().Get("Content-Range"); cr != "bytes 3-6/10" {
		t.Errorf("Content-Range = %q", cr)
	}
}

func TestStreamOfMissingVideos(t *testing.T) {
	s := newSite(t)
	s.addVideo(t, "a.mp4", "a", "", 1, false)
	gone := s.addVideo(t, "b.mp4", "b", "", 1, false)
	if _, err := s.db.Exec(`UPDATE videos SET missing_since = 1 WHERE id = ?`, gone); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(s.library, "a.mp4")); err != nil {
		t.Fatal(err)
	}

	for _, target := range []string{"/api/videos/1/stream", "/api/videos/2/stream", "/api/videos/9/stream"} {
		if rec := s.get(t, target); rec.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", target, rec.Code)
		}
	}
}

func TestCover(t *testing.T) {
	s := newSite(t)
	dir := filepath.Join(s.dataDir, media.CoversDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "1-abc.jpg"), []byte("jpeg"), 0o600); err != nil {
		t.Fatal(err)
	}

	rec := s.get(t, "/api/covers/1-abc.jpg")
	if rec.Code != http.StatusOK || rec.Body.String() != "jpeg" {
		t.Fatalf("cover: %d %q", rec.Code, rec.Body)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q", cc)
	}

	for _, target := range []string{
		"/api/covers/2-abc.jpg",            // no such file
		"/api/covers/..%2Ffranzplay.db",    // trying to leave the folder
		"/api/covers/" + database.FileName, // not a cover name
	} {
		if rec := s.get(t, target); rec.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", target, rec.Code)
		}
	}
}
