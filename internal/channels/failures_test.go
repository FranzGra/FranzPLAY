package channels

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/playlists"
)

// With the database gone, or the lists failing, both routes answer 500
// with a plain message.
func TestDatabaseFailing(t *testing.T) {
	db := newDB(t)
	broken := func(context.Context, int64) ([]playlists.Playlist, error) { return nil, errors.New("disk error") }
	mux := muxFor(db, broken)
	if rec := get(mux, "/api/channels/1", true); rec.Code != http.StatusInternalServerError {
		t.Errorf("lists failing: %d %s, want 500", rec.Code, rec.Body)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{"/api/channels?q=anna", "/api/channels/1"} {
		rec := get(mux, target, true)
		if rec.Code != http.StatusInternalServerError || strings.Contains(strings.ToLower(rec.Body.String()), "disk") ||
			strings.Contains(strings.ToLower(rec.Body.String()), "sql") {
			t.Errorf("%s: %d %s, want 500 with no detail", target, rec.Code, rec.Body)
		}
	}
}

// Routes puts both routes on the mux, for logged-in people only.
func TestRoutes(t *testing.T) {
	mux := http.NewServeMux()
	Routes(newDB(t), nil, slog.New(slog.NewTextHandler(io.Discard, nil)))(mux)
	for _, target := range []string{"/api/channels?q=anna", "/api/channels/1"} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, target, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: %d, want 401", target, rec.Code)
		}
	}
}
