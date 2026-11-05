package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/catalog"
	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/home"
	"github.com/FranzGra/FranzPLAY/internal/server"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// benchVideos is the size of the catalog of the benchmarks: a big library
// of a home server.
const benchVideos = 5000

// benchSite builds the site as run() does for what people open most, the
// home, the list and one video, behind the login, on a full catalog. It
// returns the handler and the session cookie of the administrator.
func benchSite(b *testing.B) (http.Handler, *http.Cookie) {
	b.Helper()
	ctx := context.Background()
	dataDir := b.TempDir()
	db, err := database.Open(ctx, dataDir)
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = db.Close() })
	if _, err := db.Exec(`INSERT INTO libraries (id, path) VALUES (1, ?)`, b.TempDir()); err != nil {
		b.Fatal(err)
	}
	if _, err := db.Exec(`WITH RECURSIVE i(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM i WHERE n < ?)
		INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, folder_category, added_at,
			duration, width, height, video_codec, audio_codec, container, cover)
		SELECT 'fp-' || n, 1, 'Serie/Cartella ' || (n % 100) || '/Video ' || n || '.mp4', n, 1,
			'Video ' || n, 'Serie/Cartella ' || (n % 100), n,
			90, 1280, 720, 'h264', 'aac', 'mov,mp4', n || '-abc.jpg' FROM i`, benchVideos); err != nil {
		b.Fatal(err)
	}
	logger := slog.New(slog.DiscardHandler)
	root := content.Root(dataDir)
	accounts, err := users.NewService(ctx, db, root, false, logger)
	if err != nil {
		b.Fatal(err)
	}
	handler := accounts.Protect(server.New("bench", logger, http.NotFoundHandler(),
		accounts.Routes, catalog.Routes(db, root, logger), home.Routes(db, logger)))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest("POST", "/api/setup",
		strings.NewReader(`{"name": "Admin", "password": "admin-password-1"}`)))
	if rec.Code != http.StatusCreated {
		b.Fatalf("setup = %d %s", rec.Code, rec.Body)
	}
	for _, c := range rec.Result().Cookies() {
		if c.Name == "franzplay_session" {
			return handler, c
		}
	}
	b.Fatal("no session cookie")
	return nil, nil
}

// BenchmarkPages measures the whole way of a request a person makes:
// session check, then the answer, on a catalog of benchVideos videos.
func BenchmarkPages(b *testing.B) {
	handler, session := benchSite(b)
	for _, bb := range []struct{ name, target string }{
		{"home", "/api/home"},
		{"video list", "/api/videos"},
		{"video list page 40", "/api/videos?offset=2000"},
		{"video list search", "/api/videos?q=video%2042"},
		{"video detail", fmt.Sprintf("/api/videos/%d", benchVideos/2)},
		{"not logged in", "/api/home"},
	} {
		b.Run(bb.name, func(b *testing.B) {
			want := http.StatusOK
			if bb.name == "not logged in" {
				want = http.StatusUnauthorized
			}
			b.ReportAllocs()
			for b.Loop() {
				req := httptest.NewRequest(http.MethodGet, bb.target, nil)
				if want == http.StatusOK {
					req.AddCookie(session)
				}
				rec := httptest.NewRecorder()
				handler.ServeHTTP(rec, req)
				if rec.Code != want {
					b.Fatalf("%s: %d %s", bb.target, rec.Code, rec.Body)
				}
			}
		})
	}
}
