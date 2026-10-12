package likes

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/catalog"
	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

const (
	giulia int64 = 1
	marco  int64 = 2
)

type userKey struct{}

type site struct {
	db  *sql.DB
	mux *http.ServeMux
}

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
		`INSERT INTO users (id, name, password_hash, role, created_at) VALUES (1, 'Giulia', 'x', 'admin', 1), (2, 'Marco', 'x', 'user', 1)`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	s := &site{db: db, mux: http.NewServeMux()}
	// Each like a second after the one before.
	clock := int64(1_000_000)
	handlers{
		store:  store{db: db},
		videos: catalog.NewLookup(db),
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		now: func() time.Time {
			clock++
			return time.Unix(clock, 0)
		},
		account: func(ctx context.Context) (users.Account, bool) {
			id, ok := ctx.Value(userKey{}).(int64)
			return users.Account{ID: id}, ok
		},
	}.routes(s.mux)
	return s
}

func (s *site) addVideo(t *testing.T, name string) int64 {
	t.Helper()
	res, err := s.db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, category, added_at)
		VALUES (?, 1, ?, 1, 1, ?, '', 1)`, "fp-"+name, name, name)
	if err != nil {
		t.Fatal(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// do sends a request about the like of video as user (0 = nobody).
func (s *site) do(t *testing.T, user int64, method string, video int64) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, "/api/videos/"+strconv.FormatInt(video, 10)+"/like", nil)
	if user != 0 {
		req = req.WithContext(context.WithValue(req.Context(), userKey{}, user))
	}
	rec := httptest.NewRecorder()
	s.mux.ServeHTTP(rec, req)
	return rec
}

func (s *site) like(t *testing.T, user int64, method string, video int64) Like {
	t.Helper()
	rec := s.do(t, user, method, video)
	if rec.Code != http.StatusOK {
		t.Fatalf("%s as %d: %d %s", method, user, rec.Code, rec.Body)
	}
	var l Like
	if err := json.NewDecoder(rec.Body).Decode(&l); err != nil {
		t.Fatal(err)
	}
	return l
}

func TestLikes(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "mare.mp4")
	other := s.addVideo(t, "montagna.mp4")

	if got := s.like(t, giulia, http.MethodGet, video); got != (Like{}) {
		t.Errorf("nobody likes it yet: %+v", got)
	}
	if got := s.like(t, giulia, http.MethodPut, video); got != (Like{Liked: true, Count: 1}) {
		t.Errorf("Giulia likes it: %+v", got)
	}
	// A second click does not count twice.
	if got := s.like(t, giulia, http.MethodPut, video); got != (Like{Liked: true, Count: 1}) {
		t.Errorf("Giulia likes it again: %+v", got)
	}
	if got := s.like(t, marco, http.MethodPut, video); got != (Like{Liked: true, Count: 2}) {
		t.Errorf("Marco likes it too: %+v", got)
	}
	if got := s.like(t, giulia, http.MethodDelete, video); got != (Like{Liked: false, Count: 1}) {
		t.Errorf("Giulia takes it back: %+v", got)
	}
	if got := s.like(t, giulia, http.MethodDelete, video); got != (Like{Liked: false, Count: 1}) {
		t.Errorf("Giulia takes it back again: %+v", got)
	}
	if got := s.like(t, marco, http.MethodGet, video); got != (Like{Liked: true, Count: 1}) {
		t.Errorf("Marco sees: %+v", got)
	}
	if got := s.like(t, marco, http.MethodGet, other); got != (Like{}) {
		t.Errorf("another video: %+v", got)
	}
}

func TestLikesRefused(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "mare.mp4")
	gone := s.addVideo(t, "via.mp4")
	if _, err := s.db.Exec(`UPDATE videos SET missing_since = 1 WHERE id = ?`, gone); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name   string
		user   int64
		method string
		video  int64
		want   int
	}{
		{"nobody logged in", 0, http.MethodPut, video, http.StatusUnauthorized},
		{"unknown video", giulia, http.MethodPut, 999, http.StatusNotFound},
		{"missing video", giulia, http.MethodPut, gone, http.StatusNotFound},
		{"bad id", giulia, http.MethodGet, 0, http.StatusNotFound},
	}
	for _, tt := range tests {
		if rec := s.do(t, tt.user, tt.method, tt.video); rec.Code != tt.want {
			t.Errorf("%s: %d %s, want %d", tt.name, rec.Code, rec.Body, tt.want)
		}
	}
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM likes`).Scan(&n); err != nil || n != 0 {
		t.Errorf("likes saved = %d (%v), want 0", n, err)
	}
}

func TestLikesGoWithTheVideoAndThePerson(t *testing.T) {
	s := newSite(t)
	a := s.addVideo(t, "a.mp4")
	b := s.addVideo(t, "b.mp4")
	s.like(t, giulia, http.MethodPut, a)
	s.like(t, giulia, http.MethodPut, b)
	s.like(t, marco, http.MethodPut, b)
	for _, q := range []string{`DELETE FROM videos WHERE id = ` + strconv.FormatInt(a, 10), `DELETE FROM users WHERE id = 1`} {
		if _, err := s.db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	if got := s.like(t, marco, http.MethodGet, b); got != (Like{Liked: true, Count: 1}) {
		t.Errorf("left: %+v, want only Marco's", got)
	}
}

// liked asks for the videos user likes; query is the part after "?".
func (s *site) liked(t *testing.T, user int64, query string) (*httptest.ResponseRecorder, videoList) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/likes?"+query, nil)
	if user != 0 {
		req = req.WithContext(context.WithValue(req.Context(), userKey{}, user))
	}
	rec := httptest.NewRecorder()
	s.mux.ServeHTTP(rec, req)
	var list videoList
	if rec.Code == http.StatusOK {
		if err := json.NewDecoder(rec.Body).Decode(&list); err != nil {
			t.Fatal(err)
		}
	}
	return rec, list
}

func titles(list videoList) []string {
	out := []string{}
	for _, v := range list.Videos {
		out = append(out, v.Title)
	}
	return out
}

func TestLikedList(t *testing.T) {
	s := newSite(t)
	a := s.addVideo(t, "a.mp4")
	b := s.addVideo(t, "b.mp4")
	c := s.addVideo(t, "c.mp4")
	gone := s.addVideo(t, "via.mp4")

	if rec, list := s.liked(t, giulia, ""); rec.Code != http.StatusOK || list.Total != 0 || list.Videos == nil {
		t.Fatalf("nothing liked yet: %d %+v, want an empty list", rec.Code, list)
	}

	s.like(t, giulia, http.MethodPut, b)
	s.like(t, giulia, http.MethodPut, a)
	s.like(t, giulia, http.MethodPut, gone)
	s.like(t, marco, http.MethodPut, c)
	if _, err := s.db.Exec(`UPDATE videos SET missing_since = 1 WHERE id = ?`, gone); err != nil {
		t.Fatal(err)
	}

	// The last liked first; a missing video and Marco's likes do not count.
	_, list := s.liked(t, giulia, "")
	if got := titles(list); list.Total != 2 || len(got) != 2 || got[0] != "a.mp4" || got[1] != "b.mp4" {
		t.Errorf("Giulia's likes: %v (total %d), want [a.mp4 b.mp4] (2)", got, list.Total)
	}
	_, list = s.liked(t, giulia, "limit=1&offset=1")
	if got := titles(list); list.Total != 2 || len(got) != 1 || got[0] != "b.mp4" {
		t.Errorf("second page: %v (total %d), want [b.mp4] (2)", got, list.Total)
	}

	tests := []struct {
		name  string
		user  int64
		query string
		want  int
	}{
		{"nobody logged in", 0, "", http.StatusUnauthorized},
		{"limit zero", giulia, "limit=0", http.StatusBadRequest},
		{"limit too big", giulia, "limit=201", http.StatusBadRequest},
		{"negative offset", giulia, "offset=-1", http.StatusBadRequest},
		{"limit not a number", giulia, "limit=tanti", http.StatusBadRequest},
	}
	for _, tt := range tests {
		if rec, _ := s.liked(t, tt.user, tt.query); rec.Code != tt.want {
			t.Errorf("%s: %d %s, want %d", tt.name, rec.Code, rec.Body, tt.want)
		}
	}
}
