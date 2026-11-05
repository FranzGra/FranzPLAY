package likes

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/catalog"
)

// With the database gone, every route answers 500 with a plain message.
func TestDatabaseFailing(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "mare.mp4")
	if err := s.db.Close(); err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodDelete} {
		if rec := s.do(t, giulia, method, video); rec.Code != http.StatusInternalServerError ||
			strings.Contains(strings.ToLower(rec.Body.String()), "sql") {
			t.Errorf("%s: %d %s, want 500 with no detail", method, rec.Code, rec.Body)
		}
	}
	if rec, _ := s.liked(t, giulia, ""); rec.Code != http.StatusInternalServerError {
		t.Errorf("liked list: %d, want 500", rec.Code)
	}
}

// Routes puts every route on the mux, each for logged-in people only.
func TestRoutes(t *testing.T) {
	s := newSite(t)
	mux := http.NewServeMux()
	Routes(s.db, catalog.NewLookup(s.db), slog.New(slog.NewTextHandler(io.Discard, nil)))(mux)
	for _, r := range []struct{ method, target string }{
		{http.MethodGet, "/api/videos/1/like"},
		{http.MethodPut, "/api/videos/1/like"},
		{http.MethodDelete, "/api/videos/1/like"},
		{http.MethodGet, "/api/likes"},
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), r.method, r.target, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: %d, want 401", r.method, r.target, rec.Code)
		}
	}
}
