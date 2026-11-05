package catalog

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/server"
)

// folderName gives a folder category the name the scan would give it.
func (s *site) folderName(t *testing.T, name, shown string) {
	t.Helper()
	if _, err := s.db.Exec(`INSERT INTO folder_categories (name, shown) VALUES (?, ?)`, name, shown); err != nil {
		t.Fatal(err)
	}
}

// TestSearchAndFilterUseTheNameShown: people look for a category by the name
// they see, never by the path of its folder.
func TestSearchAndFilterUseTheNameShown(t *testing.T) {
	s := newSite(t)
	s.addVideo(t, "Città d'arte/Perù 🎒 (2019)/a.mp4", "a", "Città d'arte/Perù 🎒 (2019)", 1, false)
	s.addVideo(t, "Serie A/Stagione 1/b.mp4", "b", "Serie A/Stagione 1", 2, false)
	s.addVideo(t, "Serie B/Stagione 1/c.mp4", "c", "Serie B/Stagione 1", 3, false)
	s.folderName(t, "Città d'arte/Perù 🎒 (2019)", "Perù 🎒 (2019)")
	s.folderName(t, "Serie A/Stagione 1", "Serie A › Stagione 1")
	s.folderName(t, "Serie B/Stagione 1", "Serie B › Stagione 1")

	total := func(query string) int {
		t.Helper()
		return decode[listResponse](t, s.get(t, "/api/videos?"+query)).Total
	}
	for query, want := range map[string]int{
		"category=" + url.QueryEscape("Perù 🎒 (2019)"):              1,
		"category=" + url.QueryEscape("Città d'arte/Perù 🎒 (2019)"): 0, // the path is not a name people see
		"category=" + url.QueryEscape("Serie A › Stagione 1"):       1,
		"category=" + url.QueryEscape("Stagione 1"):                 0,
		"q=" + url.QueryEscape("stagione"):                          2,
		"q=" + url.QueryEscape("🎒"):                                 1,
		"q=" + url.QueryEscape("(2019)"):                            1,
		"q=" + url.QueryEscape("perù"):                              1,
	} {
		if got := total(query); got != want {
			t.Errorf("%s: %d videos, want %d", query, got, want)
		}
	}
}

// TestFoldersGivenOneNameShowAsOne: two folders the administrator gave the
// same name are one category, with the videos of both and the cover of the
// newest video of the two.
func TestFoldersGivenOneNameShowAsOne(t *testing.T) {
	s := newSite(t)
	a := s.addVideo(t, "Serie A/Stagione 1/a.mp4", "a", "Serie A/Stagione 1", 0, false)
	b := s.addVideo(t, "Serie B/Stagione 1/b.mp4", "b", "Serie B/Stagione 1", 0, false)
	s.addVideo(t, "Serie B/Stagione 1/c.mp4", "c", "Serie B/Stagione 1", 0, false)
	for _, q := range []string{
		`INSERT INTO categories (name, label) VALUES ('Serie A/Stagione 1', 'Stagioni'), ('Serie B/Stagione 1', 'Stagioni')`,
		fmt.Sprintf(`UPDATE videos SET cover = '9-old.jpg', added_at = 100 WHERE id = %d`, a),
		fmt.Sprintf(`UPDATE videos SET cover = '1-new.jpg', added_at = 300 WHERE id = %d`, b),
	} {
		if _, err := s.db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	got := decode[[]Category](t, s.get(t, "/api/categories"))
	if len(got) != 1 || got[0].Name != "Stagioni" || got[0].Videos != 3 {
		t.Fatalf("categories = %+v", got)
	}
	if list := decode[listResponse](t, s.get(t, "/api/videos?category=Stagioni")); list.Total != 3 {
		t.Errorf("videos of Stagioni: %d", list.Total)
	}
	t.Run("cover", func(t *testing.T) {
		if got[0].Cover == nil || *got[0].Cover != "/api/covers/1-new.jpg" {
			if got[0].Cover != nil {
				t.Errorf("cover = %s, want the newest video's, 1-new.jpg", *got[0].Cover)
			} else {
				t.Error("no cover, want the newest video's, 1-new.jpg")
			}
		}
	})
}

// seedCatalog fills the catalog with n visible videos in folders categories,
// as a big library after its first scan.
func seedCatalog(tb testing.TB, db *sql.DB, n, folders int) {
	tb.Helper()
	if _, err := db.Exec(`WITH RECURSIVE i(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM i WHERE n < ?)
		INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, folder_category, added_at,
			duration, width, height, video_codec, audio_codec, container, cover)
		SELECT 'fp-' || n, 1, 'Raccolta/Cartella ' || (n % ?) || '/Video numero ' || n || '.mp4', n, 1,
			'Video numero ' || n, 'Raccolta/Cartella ' || (n % ?), n,
			90, 1280, 720, 'h264', 'aac', 'mov,mp4', n || '-abc.jpg' FROM i`, n, folders, folders); err != nil {
		tb.Fatal(err)
	}
	if _, err := db.Exec(`WITH RECURSIVE i(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM i WHERE n < ? - 1)
		INSERT INTO folder_categories (name, shown) SELECT 'Raccolta/Cartella ' || n, 'Cartella ' || n FROM i`, folders); err != nil {
		tb.Fatal(err)
	}
}

func TestSeedCatalog(t *testing.T) {
	s := newSite(t)
	seedCatalog(t, s.db, 500, 20)
	if list := decode[listResponse](t, s.get(t, "/api/videos?category="+url.QueryEscape("Cartella 3"))); list.Total != 25 {
		t.Errorf("videos of Cartella 3: %d, want 25", list.Total)
	}
	if got := decode[[]Category](t, s.get(t, "/api/categories")); len(got) != 20 {
		t.Errorf("%d categories, want 20", len(got))
	}
}

// BenchmarkCatalog asks the questions of the home page on a catalog of
// 10000 videos in 200 folders.
func BenchmarkCatalog(b *testing.B) {
	dataDir := b.TempDir()
	db, err := database.Open(context.Background(), dataDir)
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = db.Close() })
	if _, err := db.Exec(`INSERT INTO libraries (id, path) VALUES (1, ?)`, b.TempDir()); err != nil {
		b.Fatal(err)
	}
	seedCatalog(b, db, 10000, 200)
	logger := slog.New(slog.DiscardHandler)
	handler := server.New("test", logger, http.NotFoundHandler(), Routes(db, content.Root(dataDir), logger))
	for _, bb := range []struct{ name, target string }{
		{"newest", "/api/videos"},
		{"page 50", "/api/videos?offset=3000"},
		{"category", "/api/videos?category=" + url.QueryEscape("Cartella 7")},
		{"search", "/api/videos?q=" + url.QueryEscape("numero 99")},
		{"search category", "/api/videos?q=" + url.QueryEscape("cartella 7")},
		{"random", "/api/videos?order=random&seed=42"},
		{"categories", "/api/categories"},
	} {
		b.Run(bb.name, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				rec := httptest.NewRecorder()
				handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, bb.target, nil))
				if rec.Code != http.StatusOK {
					b.Fatalf("%s: %d %s", bb.target, rec.Code, rec.Body)
				}
			}
		})
	}
}
