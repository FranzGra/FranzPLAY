package channels

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/playlists"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

func newMux(t *testing.T, lists func(context.Context, int64) ([]playlists.Playlist, error)) *http.ServeMux {
	t.Helper()
	db, err := database.Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	if _, err := db.Exec(`INSERT INTO users (id, name, password_hash, role, created_at)
		VALUES (1, 'Giulia', 'x', 'admin', 1700000000), (2, 'Marco', 'x', 'user', 1)`); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	handlers{
		db:     db,
		lists:  lists,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		account: func(ctx context.Context) (users.Account, bool) {
			a, ok := ctx.Value(accountKey{}).(users.Account)
			return a, ok
		},
	}.routes(mux)
	return mux
}

type accountKey struct{}

func get(mux *http.ServeMux, target string, logged bool) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if logged {
		req = req.WithContext(context.WithValue(req.Context(), accountKey{}, users.Account{ID: 2}))
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestChannel(t *testing.T) {
	var asked int64
	mux := newMux(t, func(_ context.Context, owner int64) ([]playlists.Playlist, error) {
		asked = owner
		return []playlists.Playlist{{ID: 7, Kind: playlists.Ordinary, Name: "Gite", Public: true}}, nil
	})
	rec := get(mux, "/api/channels/1", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("answer %d %s", rec.Code, rec.Body)
	}
	var c Channel
	if err := json.NewDecoder(rec.Body).Decode(&c); err != nil {
		t.Fatal(err)
	}
	if c.ID != 1 || c.Name != "Giulia" || !c.Since.Equal(time.Unix(1700000000, 0)) ||
		len(c.Playlists) != 1 || c.Playlists[0].ID != 7 || asked != 1 {
		t.Errorf("channel = %+v, lists asked for %d", c, asked)
	}
}

func TestChannelRefused(t *testing.T) {
	mux := newMux(t, func(context.Context, int64) ([]playlists.Playlist, error) {
		return nil, errors.New("disk on fire")
	})
	tests := []struct {
		name, target string
		logged       bool
		want         int
	}{
		{"nobody logged in", "/api/channels/1", false, http.StatusUnauthorized},
		{"not an id", "/api/channels/x", true, http.StatusNotFound},
		{"nobody with that id", "/api/channels/99", true, http.StatusNotFound},
		{"lists fail", "/api/channels/1", true, http.StatusInternalServerError},
	}
	for _, tt := range tests {
		if rec := get(mux, tt.target, tt.logged); rec.Code != tt.want {
			t.Errorf("%s: %d %s, want %d", tt.name, rec.Code, rec.Body, tt.want)
		}
	}
}
