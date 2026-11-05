package progress

import (
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/catalog"
)

// With the database gone (a disk that fails, a file locked), every route
// answers 500 with a plain message: no panic, no detail of the error.
func TestDatabaseFailing(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "mare.mp4", 600)
	s.save(t, giulia, video, "100")
	if err := s.db.Close(); err != nil {
		t.Fatal(err)
	}
	for _, r := range []struct{ method, target, body string }{
		{http.MethodGet, "/api/videos/1/progress", ""},
		{http.MethodPost, "/api/videos/1/progress", `{"position":200}`},
		{http.MethodGet, "/api/continue", ""},
		{http.MethodDelete, "/api/continue/1", ""},
		{http.MethodGet, "/api/history", ""},
		{http.MethodDelete, "/api/history", ""},
		{http.MethodDelete, "/api/history/1", ""},
	} {
		rec := s.do(t, giulia, r.method, r.target, r.body)
		if rec.Code != http.StatusInternalServerError || strings.Contains(strings.ToLower(rec.Body.String()), "sql") {
			t.Errorf("%s %s: %d %s, want 500 with no detail", r.method, r.target, rec.Code, rec.Body)
		}
	}
}

// Routes puts every route on the mux, each for logged-in people only.
func TestRoutes(t *testing.T) {
	s := newSite(t)
	mux := http.NewServeMux()
	Routes(s.db, catalog.NewLookup(s.db), slog.New(slog.NewTextHandler(io.Discard, nil)))(mux)
	s.mux = mux
	for _, r := range []struct{ method, target string }{
		{http.MethodGet, "/api/videos/1/progress"},
		{http.MethodPost, "/api/videos/1/progress"},
		{http.MethodGet, "/api/continue"},
		{http.MethodDelete, "/api/continue/1"},
		{http.MethodGet, "/api/history"},
		{http.MethodDelete, "/api/history"},
		{http.MethodDelete, "/api/history/1"},
	} {
		if rec := s.do(t, 0, r.method, r.target, ""); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: %d, want 401", r.method, r.target, rec.Code)
		}
	}
}
