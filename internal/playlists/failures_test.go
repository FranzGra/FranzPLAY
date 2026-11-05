package playlists

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
	video := s.addVideo(t, "mare")
	list := s.create(t, giulia, "Lista")
	if err := s.db.Close(); err != nil {
		t.Fatal(err)
	}
	for _, r := range []struct{ method, target, body string }{
		{http.MethodGet, "/api/playlists", ""},
		{http.MethodPost, "/api/playlists", `{"name":"Nuova"}`},
		{http.MethodGet, "/api/playlists/shared", ""},
		{http.MethodGet, path(list.ID), ""},
		{http.MethodPut, path(list.ID), `{"name":"Altro"}`},
		{http.MethodDelete, path(list.ID), ""},
		{http.MethodPut, path(list.ID, video), ""},
		{http.MethodDelete, path(list.ID, video), ""},
	} {
		rec := s.do(t, giulia, r.method, r.target, r.body)
		if rec.Code != http.StatusInternalServerError || strings.Contains(strings.ToLower(rec.Body.String()), "sql") {
			t.Errorf("%s %s: %d %s, want 500 with no detail", r.method, r.target, rec.Code, rec.Body)
		}
	}
	if _, err := PublicLists(s.db, catalog.NewLookup(s.db))(context.Background(), giulia); err == nil {
		t.Error("PublicLists with the database gone: no error")
	}
}

// Routes puts every route on the mux, each for logged-in people only.
func TestRoutes(t *testing.T) {
	s := newSite(t)
	mux := http.NewServeMux()
	Routes(s.db, catalog.NewLookup(s.db), slog.New(slog.NewTextHandler(io.Discard, nil)))(mux)
	for _, r := range []struct{ method, target string }{
		{http.MethodGet, "/api/playlists"},
		{http.MethodPost, "/api/playlists"},
		{http.MethodGet, "/api/playlists/shared"},
		{http.MethodGet, "/api/playlists/1"},
		{http.MethodPut, "/api/playlists/1"},
		{http.MethodDelete, "/api/playlists/1"},
		{http.MethodPut, "/api/playlists/1/videos/1"},
		{http.MethodDelete, "/api/playlists/1/videos/1"},
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), r.method, r.target, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: %d, want 401", r.method, r.target, rec.Code)
		}
	}
}
