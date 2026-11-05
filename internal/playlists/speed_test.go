package playlists

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/catalog"
	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// fullHouse is the playlists API where person 1 has the most lists
// allowed, each with 20 videos, and list 1 is full: the heaviest pages a
// person can ask for.
func fullHouse(b *testing.B) *http.ServeMux {
	b.Helper()
	db, err := database.Open(context.Background(), b.TempDir())
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() {
		if err := db.Close(); err != nil {
			b.Error(err)
		}
	})
	for _, q := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO libraries (id, path) VALUES (1, '/video')`, nil},
		{`INSERT INTO users (id, name, password_hash, role, created_at) VALUES (1, 'Giulia', 'x', 'admin', 1)`, nil},
		{`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
			INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, folder_category, added_at, cover)
			SELECT 'fp' || i, 1, 'video ' || i || '.mp4', 1, 1, 'Video ' || i, '', i, 'c' || i || '.jpg' FROM n`,
			[]any{maxVideos}},
		{`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
			INSERT INTO playlists (id, user_id, kind, name, created_at, updated_at)
			SELECT i, 1, 'playlist', 'Lista ' || i, 1, i FROM n`, []any{maxPlaylists - 1}},
		{`INSERT INTO playlist_items (playlist_id, video_id, position, added_at) SELECT 1, id, id, 1 FROM videos`, nil},
		{`INSERT OR IGNORE INTO playlist_items (playlist_id, video_id, position, added_at)
			SELECT p.id, 1 + (p.id * 13 + v.i * 101) % ?, v.i, 1
			FROM playlists p, (WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 20) SELECT i FROM n) v
			WHERE p.id > 1`, []any{maxVideos}},
	} {
		if _, err := db.Exec(q.query, q.args...); err != nil {
			b.Fatal(err)
		}
	}
	mux := http.NewServeMux()
	handlers{
		store:  store{db: db},
		videos: catalog.NewLookup(db),
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		now:    func() time.Time { return time.Unix(2_000_000, 0) },
		account: func(ctx context.Context) (users.Account, bool) {
			id, ok := ctx.Value(userKey{}).(int64)
			return users.Account{ID: id}, ok
		},
	}.routes(mux)
	return mux
}

func benchGet(b *testing.B, mux *http.ServeMux, target string) {
	b.Helper()
	b.ReportAllocs()
	for b.Loop() {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		req = req.WithContext(context.WithValue(req.Context(), userKey{}, giulia))
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			b.Fatalf("%s: %d %s", target, rec.Code, rec.Body)
		}
	}
}

// BenchmarkAllMyLists is the lists page with 500 lists, asking which
// ones hold a video, as the "save to a list" window does.
func BenchmarkAllMyLists(b *testing.B) {
	benchGet(b, fullHouse(b), "/api/playlists?video=42")
}

// BenchmarkFullListPage is a list of 5,000 videos opened.
func BenchmarkFullListPage(b *testing.B) {
	benchGet(b, fullHouse(b), "/api/playlists/1")
}
