package recommend

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"sync"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/catalog"
	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// family is a library of videos, the people of a big house and what each
// one watched and liked, all made in the database at once.
type family struct {
	videos, people, watched, liked int
}

// fill makes f in db. Who watched what follows fixed steps, never chance,
// so every run sees the same data.
func (f family) fill(tb testing.TB, db *sql.DB) {
	tb.Helper()
	for _, q := range []struct {
		query string
		args  []any
	}{
		{`INSERT OR IGNORE INTO libraries (id, path) VALUES (1, '/video')`, nil},
		{`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
			INSERT OR IGNORE INTO users (id, name, password_hash, role, created_at)
			SELECT i, 'persona ' || i, 'x', 'user', 1 FROM n`, []any{f.people}},
		{`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?),
			w(k, word) AS (VALUES (0, 'Gita'), (1, 'mare'), (2, 'festa'), (3, 'cena'), (4, 'partita'),
				(5, 'lezione'), (6, 'concerto'), (7, 'viaggio'), (8, 'nonna'), (9, 'compleanno'))
			INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, folder_category, added_at)
			SELECT 'fp' || i, 1, 'cartella ' || (i % 40) || '/video ' || i || '.mp4', 1, 1,
				(SELECT word FROM w WHERE k = i % 10) || ' ' || (SELECT word FROM w WHERE k = (i / 10) % 10) || ' ' || i,
				'Categoria ' || (i % 12), i / 3
			FROM n`, []any{f.videos}},
		{`WITH RECURSIVE p(u) AS (SELECT 1 UNION ALL SELECT u + 1 FROM p WHERE u < ?),
			k(j) AS (SELECT 0 UNION ALL SELECT j + 1 FROM k WHERE j < ? - 1)
			INSERT OR IGNORE INTO watch_progress (user_id, video_id, position, finished, updated_at)
			SELECT u, 1 + (u * 37 + j * 101) % ?, 60, (u + j) % 3 = 0, j FROM p, k`,
			[]any{f.people, f.watched, f.videos}},
		{`WITH RECURSIVE p(u) AS (SELECT 1 UNION ALL SELECT u + 1 FROM p WHERE u < ?),
			k(j) AS (SELECT 0 UNION ALL SELECT j + 1 FROM k WHERE j < ? - 1)
			INSERT OR IGNORE INTO likes (user_id, video_id, created_at)
			SELECT u, 1 + (u * 53 + j * 211) % ?, j FROM p, k`,
			[]any{f.people, f.liked, f.videos}},
	} {
		if _, err := db.Exec(q.query, q.args...); err != nil {
			tb.Fatal(err)
		}
	}
}

// bigSite is the suggestions API on a database filled with f.
func bigSite(tb testing.TB, f family) (*sql.DB, *http.ServeMux) {
	tb.Helper()
	db, err := database.Open(context.Background(), tb.TempDir())
	if err != nil {
		tb.Fatal(err)
	}
	tb.Cleanup(func() {
		if err := db.Close(); err != nil {
			tb.Error(err)
		}
	})
	f.fill(tb, db)
	mux := http.NewServeMux()
	handlers{
		store:  newStore(db),
		videos: catalog.NewLookup(db),
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		account: func(ctx context.Context) (users.Account, bool) {
			id, ok := ctx.Value(userKey{}).(int64)
			return users.Account{ID: id}, ok
		},
	}.routes(mux)
	return db, mux
}

func ask(mux *http.ServeMux, user int64, target string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req = req.WithContext(context.WithValue(req.Context(), userKey{}, user))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

// With no videos at all, there is nothing to suggest, and no error.
func TestSuggestionsOfAnEmptyLibrary(t *testing.T) {
	s := newSite(t)
	if got := s.picks(t, giulia, "/api/recommended"); len(got) != 0 {
		t.Errorf("recommended = %v, want none", got)
	}
	if rec := s.get(t, giulia, "/api/videos/1/similar"); rec.Code != http.StatusNotFound {
		t.Errorf("similar: %d, want 404", rec.Code)
	}
	// One video alone has nothing similar.
	only := s.addVideo(t, "Solo", "Vacanze", 1)
	if got := s.picks(t, giulia, "/api/videos/"+strconv.FormatInt(only, 10)+"/similar"); len(got) != 0 {
		t.Errorf("similar of the only video = %v, want none", got)
	}
}

// The same data give the same suggestions, request after request, in a
// big house.
func TestSuggestionsAreTheSameEveryTime(t *testing.T) {
	_, mux := bigSite(t, family{videos: 2000, people: 20, watched: 50, liked: 10})
	for _, target := range []string{"/api/recommended", "/api/videos/42/similar", "/api/videos/1999/similar"} {
		first := ask(mux, 3, target)
		if first.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", target, first.Code, first.Body)
		}
		if first.Body.String() == "[]\n" {
			t.Errorf("%s: no suggestions in a big house", target)
		}
		for range 3 {
			if again := ask(mux, 3, target); again.Body.String() != first.Body.String() {
				t.Fatalf("%s changed between two requests:\n%s\n%s", target, first.Body, again.Body)
			}
		}
	}
}

// The order the database gives the videos in never matters: shuffled,
// the library gives the same suggestions.
func TestSuggestionsDoNotDependOnTheOrderOfTheLibrary(t *testing.T) {
	all := bigLibrary(3000)
	// Many videos added at the same moment: only the id can break the tie.
	for i := range all {
		all[i].AddedAt = int64(i / 50)
	}
	taste := Taste{Categories: map[string]int{"Categoria 1": 2, "Categoria 7": 4}, Known: map[int64]bool{8: true, 13: true}}
	others := map[int64]int{100: 1, 200: 3, 300: 2, 2999: 1}
	together := map[int64]int{5: 2, 9: 1, 1500: 4}
	finished := map[int64]bool{5: true}
	of := all[42]
	wantFor := ForYou(all, taste, others, 12)
	wantSimilar := Similar(of, all, together, finished, 20)

	r := rand.New(rand.NewPCG(1, 2)) // fixed seed: the same shuffles every run
	for range 5 {
		shuffled := slices.Clone(all)
		r.Shuffle(len(shuffled), func(i, j int) { shuffled[i], shuffled[j] = shuffled[j], shuffled[i] })
		if got := ForYou(shuffled, taste, others, 12); !slices.Equal(got, wantFor) {
			t.Fatalf("ForYou changed with the order:\n%v\n%v", got, wantFor)
		}
		if got := Similar(of, shuffled, together, finished, 20); !slices.Equal(got, wantSimilar) {
			t.Fatalf("Similar changed with the order:\n%v\n%v", got, wantSimilar)
		}
	}
}

// A limit of zero, or a library smaller than the limit, never fails.
func TestLimitsOfTheRules(t *testing.T) {
	all := bigLibrary(5)
	taste := Taste{Categories: map[string]int{"Categoria 1": 1}, Known: map[int64]bool{}}
	if got := ForYou(all, taste, nil, 0); len(got) != 0 {
		t.Errorf("ForYou limit 0 = %v", got)
	}
	if got := Similar(all[0], all, nil, nil, 0); len(got) != 0 {
		t.Errorf("Similar limit 0 = %v", got)
	}
	if got := Similar(all[0], all, nil, nil, 100); len(got) != 4 {
		t.Errorf("Similar of 5 videos = %d picks, want the other 4", len(got))
	}
	if got := ForYou(nil, Taste{}, nil, 10); len(got) != 0 {
		t.Errorf("ForYou of nothing = %v", got)
	}
	if got := Similar(Video{ID: 1}, nil, nil, nil, 10); len(got) != 0 {
		t.Errorf("Similar of nothing = %v", got)
	}
}

// Many pages ask for suggestions while the library changes: the shared
// copy of the library is read safely (the race detector watches) and
// every answer is whole.
func TestSuggestionsWhileTheLibraryChanges(t *testing.T) {
	db, mux := bigSite(t, family{videos: 300, people: 5, watched: 20, liked: 5})
	var wg sync.WaitGroup
	errs := make(chan string, 100)
	wg.Go(func() {
		for i := range 30 {
			if _, err := db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, folder_category, added_at)
				VALUES (?, 1, ?, 1, 1, 'Nuovo mare', 'Categoria 1', 99999)`, "new"+strconv.Itoa(i), "nuovo"+strconv.Itoa(i)); err != nil {
				errs <- err.Error()
			}
		}
	})
	for user := int64(1); user <= 4; user++ {
		wg.Go(func() {
			for range 15 {
				for _, target := range []string{"/api/recommended", "/api/videos/7/similar"} {
					if rec := ask(mux, user, target); rec.Code != http.StatusOK {
						errs <- target + ": " + rec.Body.String()
					}
				}
			}
		})
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		t.Error(e)
	}
	// After the changes, the copy has every new video.
	st := newStore(db)
	all, err := st.videos(context.Background())
	if err != nil || len(all) != 330 {
		t.Errorf("library = %d videos (%v), want 330", len(all), err)
	}
}

// The suggestions of the Home and of the player, as a person in a big
// house asks for them: the database, the rules and the answer.
func BenchmarkRecommendedRequest(b *testing.B) {
	_, mux := bigSite(b, family{videos: 5000, people: 50, watched: 200, liked: 40})
	b.ReportAllocs()
	for b.Loop() {
		if rec := ask(mux, 7, "/api/recommended"); rec.Code != http.StatusOK {
			b.Fatal(rec.Code)
		}
	}
}

func BenchmarkSimilarRequest(b *testing.B) {
	_, mux := bigSite(b, family{videos: 5000, people: 50, watched: 200, liked: 40})
	b.ReportAllocs()
	for b.Loop() {
		if rec := ask(mux, 7, "/api/videos/2500/similar"); rec.Code != http.StatusOK {
			b.Fatal(rec.Code)
		}
	}
}

// BenchmarkLibraryReload is the copy of the library read again after a
// change: the cost of the first page after a scan.
func BenchmarkLibraryReload(b *testing.B) {
	db, _ := bigSite(b, family{videos: 10000, people: 1, watched: 1, liked: 1})
	st := newStore(db)
	b.ReportAllocs()
	for b.Loop() {
		st.cache.loaded = false
		if _, err := st.videos(context.Background()); err != nil {
			b.Fatal(err)
		}
	}
}
