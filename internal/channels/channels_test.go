package channels

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/playlists"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

func newMux(t *testing.T, lists func(context.Context, int64) ([]playlists.Playlist, error)) *http.ServeMux {
	t.Helper()
	return muxFor(newDB(t), lists)
}

// newDB opens an empty database with five people in it.
func newDB(t *testing.T) *sql.DB {
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
	if _, err := db.Exec(`INSERT INTO users (id, name, password_hash, role, created_at, avatar)
		VALUES (1, 'Giulia', 'x', 'admin', 1700000000, 42), (2, 'Marco', 'x', 'user', 1, 0),
		(3, 'anna Rossi', 'x', 'user', 1, 0), (4, 'Anna_Bianchi', 'x', 'user', 1, 3),
		(5, 'Annamaria Verdi', 'x', 'user', 1, 0)`); err != nil {
		t.Fatal(err)
	}
	return db
}

func muxFor(db *sql.DB, lists func(context.Context, int64) ([]playlists.Playlist, error)) *http.ServeMux {
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
	if c.ID != 1 || c.Name != "Giulia" || c.Avatar != 42 || !c.Since.Equal(time.Unix(1700000000, 0)) ||
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

func TestSearch(t *testing.T) {
	mux := newMux(t, nil)
	tests := []struct {
		name, q string
		want    []int64
	}{
		{"part of the name, any case", "ANNA", []int64{3, 4, 5}},
		{"every word must be there", "anna rossi", []int64{3}},
		{"words in any order", "rossi anna", []int64{3}},
		{"repeated words count once", "anna anna", []int64{3, 4, 5}},
		{"underscore is a letter, not a wildcard", "a_b", []int64{4}},
		{"percent is a letter, not a wildcard", "%", []int64{}},
		{"myself too", "marco", []int64{2}},
		{"nobody", "luca", []int64{}},
		{"empty search finds nobody", "  ", []int64{}},
	}
	for _, tt := range tests {
		rec := get(mux, "/api/channels?q="+url.QueryEscape(tt.q), true)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: answer %d %s", tt.name, rec.Code, rec.Body)
		}
		var got struct {
			People []map[string]any `json:"people"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
			t.Fatal(err)
		}
		ids := []int64{}
		for _, p := range got.People {
			ids = append(ids, int64(p["id"].(float64)))
		}
		if !slices.Equal(ids, tt.want) {
			t.Errorf("%s: found %v, want %v", tt.name, ids, tt.want)
		}
	}
}

func TestSearchShowsNothingPrivate(t *testing.T) {
	rec := get(newMux(t, nil), "/api/channels?q=bianchi", true)
	var got struct {
		People []map[string]any `json:"people"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"id": 4.0, "name": "Anna_Bianchi", "avatar": 3.0}
	if len(got.People) != 1 || !maps.Equal(got.People[0], want) {
		t.Errorf("people = %v, want only %v", got.People, want)
	}
}

func TestSearchRefused(t *testing.T) {
	mux := newMux(t, nil)
	if rec := get(mux, "/api/channels?q=anna", false); rec.Code != http.StatusUnauthorized {
		t.Errorf("nobody logged in: %d, want 401", rec.Code)
	}
	long := strings.Repeat("a", maxSearchLen+1)
	if rec := get(mux, "/api/channels?q="+long, true); rec.Code != http.StatusBadRequest {
		t.Errorf("too long: %d, want 400", rec.Code)
	}
}

func TestSearchLimit(t *testing.T) {
	db := newDB(t)
	for i := range maxFound {
		if _, err := db.Exec(`INSERT INTO users (name, password_hash, role, created_at)
			VALUES (?, 'x', 'user', 1)`, fmt.Sprintf("Anna %02d", i)); err != nil {
			t.Fatal(err)
		}
	}
	rec := get(muxFor(db, nil), "/api/channels?q=anna", true)
	var got struct {
		People []Person `json:"people"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.People) != maxFound || got.People[0].Name != "Anna 00" {
		t.Errorf("found %d people starting with %+v, want the first %d by name", len(got.People), got.People[0], maxFound)
	}
}
