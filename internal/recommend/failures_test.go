package recommend

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

// With the database gone, both lists answer 500 with a plain message,
// even with the library already in memory.
func TestDatabaseFailing(t *testing.T) {
	s := newSite(t)
	mare := s.addVideo(t, "Gita al mare", "Vacanze", 1)
	s.addVideo(t, "Mare d'inverno", "Vacanze", 2)
	s.watch(t, giulia, mare, false)
	s.picks(t, giulia, "/api/recommended") // the library is now in memory
	if err := s.db.Close(); err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{"/api/recommended", "/api/videos/1/similar"} {
		rec := s.get(t, giulia, target)
		if rec.Code != http.StatusInternalServerError || strings.Contains(strings.ToLower(rec.Body.String()), "sql") {
			t.Errorf("%s: %d %s, want 500 with no detail", target, rec.Code, rec.Body)
		}
	}
}

// Routes puts both routes on the mux, for logged-in people only.
func TestRoutes(t *testing.T) {
	s := newSite(t)
	mux := http.NewServeMux()
	Routes(s.db, catalog.NewLookup(s.db), slog.New(slog.NewTextHandler(io.Discard, nil)))(mux)
	for _, target := range []string{"/api/recommended", "/api/videos/1/similar"} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, target, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: %d, want 401", target, rec.Code)
		}
	}
}
