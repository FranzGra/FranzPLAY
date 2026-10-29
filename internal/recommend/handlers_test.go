package recommend

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/catalog"
	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// site is the suggestions API on a fresh database, with three people.
type site struct {
	db  *sql.DB
	mux *http.ServeMux
}

const (
	giulia int64 = 1
	marco  int64 = 2
	anna   int64 = 3
)

func newSite(t *testing.T) *site {
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
	for _, q := range []string{
		`INSERT INTO libraries (id, path) VALUES (1, '/video')`,
		`INSERT INTO users (id, name, password_hash, role, created_at)
			VALUES (1, 'Giulia', 'x', 'admin', 1), (2, 'Marco', 'x', 'user', 1), (3, 'Anna', 'x', 'user', 1)`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	s := &site{db: db, mux: http.NewServeMux()}
	handlers{
		store:  newStore(db),
		videos: catalog.NewLookup(db),
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		account: func(ctx context.Context) (users.Account, bool) {
			id, ok := ctx.Value(userKey{}).(int64)
			return users.Account{ID: id}, ok
		},
	}.routes(s.mux)
	return s
}

type userKey struct{}

// addVideo adds a present video, added at the given moment.
func (s *site) addVideo(t *testing.T, title, category string, addedAt int64) int64 {
	t.Helper()
	res, err := s.db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, folder_category, added_at)
		VALUES (?, 1, ?, 1, 1, ?, ?, ?)`, "fp-"+title, title+".mp4", title, category, addedAt)
	if err != nil {
		t.Fatal(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func (s *site) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := s.db.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

func (s *site) watch(t *testing.T, user, video int64, finished bool) {
	t.Helper()
	s.exec(t, `INSERT INTO watch_progress (user_id, video_id, position, finished, updated_at) VALUES (?, ?, 10, ?, 1)`,
		user, video, finished)
}

func (s *site) like(t *testing.T, user, video int64) {
	t.Helper()
	s.exec(t, `INSERT INTO likes (user_id, video_id, created_at) VALUES (?, ?, 1)`, user, video)
}

// get asks for target as user (0 = nobody logged in).
func (s *site) get(t *testing.T, user int64, target string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if user != 0 {
		req = req.WithContext(context.WithValue(req.Context(), userKey{}, user))
	}
	rec := httptest.NewRecorder()
	s.mux.ServeHTTP(rec, req)
	return rec
}

// picks reads an answer as "id:reason" pairs, for short comparisons.
type answered struct {
	ID     int64
	Reason Reason
}

func (s *site) picks(t *testing.T, user int64, target string) []answered {
	t.Helper()
	rec := s.get(t, user, target)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s: %d %s", target, rec.Code, rec.Body)
	}
	var items []struct {
		Video struct {
			ID int64 `json:"id"`
		} `json:"video"`
		Reason Reason `json:"reason"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&items); err != nil {
		t.Fatal(err)
	}
	out := []answered{}
	for _, it := range items {
		out = append(out, answered{it.Video.ID, it.Reason})
	}
	return out
}

func TestSimilarVideos(t *testing.T) {
	s := newSite(t)
	sea := s.addVideo(t, "Mare", "Vacanze", 100)
	mountain := s.addVideo(t, "Montagna", "Vacanze", 200)
	party := s.addVideo(t, "Compleanno", "Feste", 300)
	hidden := s.addVideo(t, "Lago", "Vacanze", 400)
	s.exec(t, `UPDATE videos SET hidden_at = 1 WHERE id = ?`, hidden)

	// Marco and Anna watched the sea and the party: for Giulia, who is
	// watching the sea, the party comes first. Her own history does not
	// count as "the others".
	s.watch(t, marco, sea, true)
	s.watch(t, marco, party, false)
	s.watch(t, anna, sea, false)
	s.watch(t, anna, party, true)
	s.watch(t, giulia, sea, false)
	s.watch(t, giulia, mountain, true)

	got := s.picks(t, giulia, "/api/videos/1/similar")
	want := []answered{{party, WatchedTogether}, {mountain, SameCategory}}
	if !slices.Equal(got, want) {
		t.Errorf("similar = %v, want %v", got, want)
	}
}

func TestSimilarOfAVideoThatIsNotThere(t *testing.T) {
	s := newSite(t)
	hidden := s.addVideo(t, "Lago", "", 1)
	s.exec(t, `UPDATE videos SET hidden_at = 1 WHERE id = ?`, hidden)
	for _, target := range []string{"/api/videos/1/similar", "/api/videos/99/similar", "/api/videos/x/similar"} {
		if rec := s.get(t, giulia, target); rec.Code != http.StatusNotFound {
			t.Errorf("GET %s: %d, want 404", target, rec.Code)
		}
	}
}

func TestRecommended(t *testing.T) {
	s := newSite(t)
	sea := s.addVideo(t, "Mare", "Vacanze", 100)
	mountain := s.addVideo(t, "Montagna", "Vacanze", 200)
	party := s.addVideo(t, "Compleanno", "Feste", 300)
	s.addVideo(t, "Senza categoria", "", 400) // no reason to suggest it to anyone

	// Nobody watched anything yet: nothing to suggest.
	if got := s.picks(t, giulia, "/api/recommended"); len(got) != 0 {
		t.Errorf("with no history: %v, want none", got)
	}

	// Giulia likes the sea, so the mountain (same category) is for her;
	// Marco watched the party. What she already saw is not suggested.
	s.like(t, giulia, sea)
	s.watch(t, marco, party, true)
	got := s.picks(t, giulia, "/api/recommended")
	want := []answered{{mountain, YourCategory}, {party, Popular}}
	if !slices.Equal(got, want) {
		t.Errorf("recommended = %v, want %v", got, want)
	}

	// For Marco: Giulia liked the sea; he watched a party, nothing else
	// of that category.
	got = s.picks(t, marco, "/api/recommended")
	want = []answered{{sea, Popular}}
	if !slices.Equal(got, want) {
		t.Errorf("recommended for Marco = %v, want %v", got, want)
	}
}

func TestSuggestionsNeedALogin(t *testing.T) {
	s := newSite(t)
	s.addVideo(t, "Mare", "", 1)
	for _, target := range []string{"/api/videos/1/similar", "/api/recommended"} {
		if rec := s.get(t, 0, target); rec.Code != http.StatusUnauthorized {
			t.Errorf("GET %s: %d, want 401", target, rec.Code)
		}
	}
}
