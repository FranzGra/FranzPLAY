package comments

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/catalog"
)

// With the database gone, every route answers 500 with a plain message.
func TestDatabaseFailing(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "mare.mp4")
	c := s.write(t, giulia, video, "ciao", 0)
	if err := s.db.Close(); err != nil {
		t.Fatal(err)
	}
	for _, r := range []struct {
		user                 int64
		method, target, body string
	}{
		{giulia, http.MethodGet, commentsOf(video), ""},
		{giulia, http.MethodPost, commentsOf(video), `{"body":"ancora"}`},
		{giulia, http.MethodDelete, "/api/comments/" + strconv.FormatInt(c.ID, 10), ""},
		{anna, http.MethodGet, "/api/comments", ""},
	} {
		rec := s.do(t, r.user, r.method, r.target, r.body)
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
	for _, r := range []struct{ method, target string }{
		{http.MethodGet, "/api/videos/1/comments"},
		{http.MethodPost, "/api/videos/1/comments"},
		{http.MethodDelete, "/api/comments/1"},
		{http.MethodGet, "/api/comments"},
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), r.method, r.target, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: %d, want 401", r.method, r.target, rec.Code)
		}
	}
}
