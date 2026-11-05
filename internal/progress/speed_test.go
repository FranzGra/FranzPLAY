package progress

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/catalog"
	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// busyHouse is the progress API on a library of n videos where each of
// people watched watched of them: a person has a long history, and so
// does everyone else.
func busyHouse(b *testing.B, n, people, watched int) *http.ServeMux {
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
		{`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
			INSERT INTO users (id, name, password_hash, role, created_at) SELECT i, 'persona ' || i, 'x', 'user', 1 FROM n`,
			[]any{people}},
		{`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
			INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, folder_category, added_at, duration)
			SELECT 'fp' || i, 1, 'video ' || i || '.mp4', 1, 1, 'Video ' || i, '', i, 3600 FROM n`, []any{n}},
		// One video in ten finished, the others left in the middle.
		{`WITH RECURSIVE p(u) AS (SELECT 1 UNION ALL SELECT u + 1 FROM p WHERE u < ?),
			k(j) AS (SELECT 0 UNION ALL SELECT j + 1 FROM k WHERE j < ? - 1)
			INSERT OR IGNORE INTO watch_progress (user_id, video_id, position, finished, updated_at)
			SELECT u, 1 + (u * 37 + j * 7) % ?, 600, j % 10 = 0, 1000 + j FROM p, k`, []any{people, watched, n}},
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

func benchRequest(b *testing.B, mux *http.ServeMux, method, target, body string, want int) {
	b.Helper()
	b.ReportAllocs()
	for b.Loop() {
		req := httptest.NewRequest(method, target, strings.NewReader(body))
		req = req.WithContext(context.WithValue(req.Context(), userKey{}, int64(1)))
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != want {
			b.Fatalf("%s %s: %d %s", method, target, rec.Code, rec.Body)
		}
	}
}

// BenchmarkContinueRow is "Continua a guardare" on the Home, for a person
// who watched 2,000 of 10,000 videos, in a house of 30.
func BenchmarkContinueRow(b *testing.B) {
	benchRequest(b, busyHouse(b, 10000, 30, 2000), http.MethodGet, "/api/continue", "", http.StatusOK)
}

// BenchmarkHistoryPage is one page of the history in the same house.
func BenchmarkHistoryPage(b *testing.B) {
	benchRequest(b, busyHouse(b, 10000, 30, 2000), http.MethodGet, "/api/history?limit=24&offset=500", "", http.StatusOK)
}

// BenchmarkSaveProgress is the save the player sends every few seconds.
func BenchmarkSaveProgress(b *testing.B) {
	benchRequest(b, busyHouse(b, 10000, 30, 2000), http.MethodPost, "/api/videos/4242/progress", `{"position":1234.5}`, http.StatusOK)
}
