package playlists

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
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
	now time.Time
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
	s := &site{db: db, mux: http.NewServeMux(), now: time.Unix(1_000_000, 0)}
	handlers{
		store:  store{db: db},
		videos: catalog.NewLookup(db),
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		now:    func() time.Time { return s.now },
		account: func(ctx context.Context) (users.Account, bool) {
			id, ok := ctx.Value(userKey{}).(int64)
			return users.Account{ID: id}, ok
		},
	}.routes(s.mux)
	return s
}

func (s *site) addVideo(t *testing.T, name string) int64 {
	t.Helper()
	res, err := s.db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, category, added_at, cover)
		VALUES (?, 1, ?, 1, 1, ?, '', 1, ?)`, "fp-"+name, name, name, name+".jpg")
	if err != nil {
		t.Fatal(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// do sends a request as user (0 = nobody) a second after the last one.
func (s *site) do(t *testing.T, user int64, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	s.now = s.now.Add(time.Second)
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if user != 0 {
		req = req.WithContext(context.WithValue(req.Context(), userKey{}, user))
	}
	rec := httptest.NewRecorder()
	s.mux.ServeHTTP(rec, req)
	return rec
}

func (s *site) must(t *testing.T, rec *httptest.ResponseRecorder, want int) *httptest.ResponseRecorder {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("answer %d %s, want %d", rec.Code, rec.Body, want)
	}
	return rec
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.NewDecoder(rec.Body).Decode(&v); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return v
}

func (s *site) create(t *testing.T, user int64, name string) Playlist {
	t.Helper()
	body, err := json.Marshal(nameRequest{Name: name})
	if err != nil {
		t.Fatal(err)
	}
	return decode[Playlist](t, s.must(t, s.do(t, user, http.MethodPost, "/api/playlists", string(body)), http.StatusCreated))
}

func (s *site) list(t *testing.T, user int64, query string) []Playlist {
	t.Helper()
	return decode[[]Playlist](t, s.must(t, s.do(t, user, http.MethodGet, "/api/playlists"+query, ""), http.StatusOK))
}

func path(parts ...int64) string {
	p := "/api/playlists/" + strconv.FormatInt(parts[0], 10)
	if len(parts) > 1 {
		p += "/videos/" + strconv.FormatInt(parts[1], 10)
	}
	return p
}

func TestWatchLaterIsAlwaysThere(t *testing.T) {
	s := newSite(t)
	first := s.list(t, giulia, "")
	if len(first) != 1 || first[0].Kind != WatchLater || first[0].Name != "" || first[0].Videos != 0 ||
		first[0].Cover != nil || first[0].Contains != nil {
		t.Fatalf("lists = %+v, want only an empty watch later", first)
	}
	if again := s.list(t, giulia, ""); len(again) != 1 || again[0].ID != first[0].ID {
		t.Errorf("asking again: %+v, want the same watch later", again)
	}
	if other := s.list(t, marco, ""); len(other) != 1 || other[0].ID == first[0].ID {
		t.Errorf("Marco: %+v, want his own watch later", other)
	}
	later := first[0].ID
	s.must(t, s.do(t, giulia, http.MethodPut, path(later), `{"name":"Altro"}`), http.StatusConflict)
	s.must(t, s.do(t, giulia, http.MethodDelete, path(later), ""), http.StatusConflict)
}

func TestMakeAndFill(t *testing.T) {
	s := newSite(t)
	mare := s.addVideo(t, "mare")
	monti := s.addVideo(t, "monti")
	lago := s.addVideo(t, "lago")

	trips := s.create(t, giulia, "  Gite   2024 ")
	if trips.Name != "Gite 2024" || trips.Kind != Ordinary || trips.Videos != 0 {
		t.Errorf("created %+v", trips)
	}
	party := s.create(t, giulia, "Feste")
	for _, v := range []int64{monti, mare, lago, mare} { // mare twice: it stays where it is
		s.must(t, s.do(t, giulia, http.MethodPut, path(trips.ID, v), ""), http.StatusNoContent)
	}

	page := decode[Page](t, s.must(t, s.do(t, giulia, http.MethodGet, path(trips.ID), ""), http.StatusOK))
	var titles []string
	for _, v := range page.Videos {
		titles = append(titles, v.Title)
	}
	if strings.Join(titles, ",") != "monti,mare,lago" || page.Playlist.Videos != 3 ||
		page.Playlist.Cover == nil || *page.Playlist.Cover != "/api/covers/monti.jpg" {
		t.Errorf("page = %+v (%v)", page.Playlist, titles)
	}

	// The list just changed comes first, after watch later; contains
	// says where the video is.
	lists := s.list(t, giulia, "?video="+strconv.FormatInt(mare, 10))
	if len(lists) != 3 || lists[0].Kind != WatchLater || lists[1].ID != trips.ID || lists[2].ID != party.ID {
		t.Fatalf("order = %+v", lists)
	}
	if *lists[0].Contains || !*lists[1].Contains || *lists[2].Contains {
		t.Errorf("contains = %v %v %v", *lists[0].Contains, *lists[1].Contains, *lists[2].Contains)
	}

	s.must(t, s.do(t, giulia, http.MethodDelete, path(trips.ID, monti), ""), http.StatusNoContent)
	s.must(t, s.do(t, giulia, http.MethodPut, path(trips.ID), `{"name":"Viaggi"}`), http.StatusNoContent)
	// A missing video is hidden, not lost.
	if _, err := s.db.Exec(`UPDATE videos SET missing_since = 1 WHERE id = ?`, lago); err != nil {
		t.Fatal(err)
	}
	page = decode[Page](t, s.must(t, s.do(t, giulia, http.MethodGet, path(trips.ID), ""), http.StatusOK))
	if page.Playlist.Name != "Viaggi" || page.Playlist.Videos != 1 || len(page.Videos) != 1 || page.Videos[0].ID != mare {
		t.Errorf("after changes = %+v %+v", page.Playlist, page.Videos)
	}

	s.must(t, s.do(t, giulia, http.MethodDelete, path(trips.ID), ""), http.StatusNoContent)
	s.must(t, s.do(t, giulia, http.MethodGet, path(trips.ID), ""), http.StatusNotFound)
	var items int
	if err := s.db.QueryRow(`SELECT count(*) FROM playlist_items`).Scan(&items); err != nil || items != 0 {
		t.Errorf("items left = %d (%v)", items, err)
	}
	var vids int
	if err := s.db.QueryRow(`SELECT count(*) FROM videos`).Scan(&vids); err != nil || vids != 3 {
		t.Errorf("videos = %d (%v): deleting a list must not touch the library", vids, err)
	}
}

func TestOnlyMine(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "mare")
	hers := s.create(t, giulia, "Di Giulia")
	s.must(t, s.do(t, giulia, http.MethodPut, path(hers.ID, video), ""), http.StatusNoContent)
	for _, r := range []struct{ method, target, body string }{
		{http.MethodGet, path(hers.ID), ""},
		{http.MethodPut, path(hers.ID), `{"name":"Mia"}`},
		{http.MethodDelete, path(hers.ID), ""},
		{http.MethodPut, path(hers.ID, video), ""},
		{http.MethodDelete, path(hers.ID, video), ""},
	} {
		if rec := s.do(t, marco, r.method, r.target, r.body); rec.Code != http.StatusNotFound {
			t.Errorf("Marco %s %s: %d, want 404", r.method, r.target, rec.Code)
		}
	}
	page := decode[Page](t, s.must(t, s.do(t, giulia, http.MethodGet, path(hers.ID), ""), http.StatusOK))
	if page.Playlist.Name != "Di Giulia" || len(page.Videos) != 1 {
		t.Errorf("Giulia's list changed: %+v", page)
	}
	if lists := s.list(t, marco, ""); len(lists) != 1 {
		t.Errorf("Marco sees %+v", lists)
	}
}

func TestPublicLists(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "mare")
	hers := s.create(t, giulia, "Gite")
	private := s.create(t, giulia, "Segreta")
	s.must(t, s.do(t, giulia, http.MethodPut, path(hers.ID, video), ""), http.StatusNoContent)
	if hers.Public || hers.Owner != (Owner{ID: giulia, Name: "Giulia"}) {
		t.Errorf("new list = %+v, want private and Giulia's", hers)
	}
	before := decode[Page](t, s.must(t, s.do(t, giulia, http.MethodGet, path(hers.ID), ""), http.StatusOK))

	s.must(t, s.do(t, giulia, http.MethodPut, path(hers.ID), `{"public":true}`), http.StatusNoContent)

	// Marco now sees it, with its videos, but cannot change it.
	page := decode[Page](t, s.must(t, s.do(t, marco, http.MethodGet, path(hers.ID), ""), http.StatusOK))
	if !page.Playlist.Public || page.Playlist.Name != "Gite" || page.Playlist.Owner.Name != "Giulia" || len(page.Videos) != 1 {
		t.Errorf("Marco sees %+v %+v", page.Playlist, page.Videos)
	}
	if !page.Playlist.UpdatedAt.Equal(before.Playlist.UpdatedAt) {
		t.Errorf("publishing changed updatedAt: %v, was %v", page.Playlist.UpdatedAt, before.Playlist.UpdatedAt)
	}
	for _, r := range []struct{ method, target, body string }{
		{http.MethodPut, path(hers.ID), `{"name":"Mia"}`},
		{http.MethodPut, path(hers.ID), `{"public":false}`},
		{http.MethodDelete, path(hers.ID), ""},
		{http.MethodPut, path(hers.ID, video), ""},
		{http.MethodDelete, path(hers.ID, video), ""},
	} {
		if rec := s.do(t, marco, r.method, r.target, r.body); rec.Code != http.StatusForbidden {
			t.Errorf("Marco %s %s: %d, want 403", r.method, r.target, rec.Code)
		}
	}
	// Her private list stays out of reach, and her lists not in his.
	s.must(t, s.do(t, marco, http.MethodGet, path(private.ID), ""), http.StatusNotFound)
	if lists := s.list(t, marco, ""); len(lists) != 1 {
		t.Errorf("Marco's own lists = %+v", lists)
	}

	public := PublicLists(s.db, catalog.NewLookup(s.db))
	got, err := public(context.Background(), giulia)
	if err != nil || len(got) != 1 || got[0].ID != hers.ID || got[0].Videos != 1 || got[0].Cover == nil {
		t.Errorf("public lists = %+v (%v), want only Gite", got, err)
	}

	s.must(t, s.do(t, giulia, http.MethodPut, path(hers.ID), `{"public":false}`), http.StatusNoContent)
	s.must(t, s.do(t, marco, http.MethodGet, path(hers.ID), ""), http.StatusNotFound)
	if got, err := public(context.Background(), giulia); err != nil || len(got) != 0 || got == nil {
		t.Errorf("after hiding = %#v (%v), want an empty list", got, err)
	}

	// "Guarda più tardi" is always private.
	later := s.list(t, giulia, "")[0]
	s.must(t, s.do(t, giulia, http.MethodPut, path(later.ID), `{"public":true}`), http.StatusConflict)
	if _, err := s.db.Exec(`UPDATE playlists SET public = 1 WHERE id = ?`, later.ID); err == nil {
		t.Error("the database let watch later become public")
	}
}

func TestSharedLists(t *testing.T) {
	s := newSite(t)
	const anna int64 = 3
	if _, err := s.db.Exec(`INSERT INTO users (id, name, password_hash, role, created_at) VALUES (3, 'Anna', 'x', 'user', 1)`); err != nil {
		t.Fatal(err)
	}
	video := s.addVideo(t, "mare")
	hers := s.create(t, giulia, "Compleanno")
	s.must(t, s.do(t, giulia, http.MethodPut, path(hers.ID, video), ""), http.StatusNoContent)
	shared := func(user int64) []Playlist {
		t.Helper()
		return decode[[]Playlist](t, s.must(t, s.do(t, user, http.MethodGet, "/api/playlists/shared", ""), http.StatusOK))
	}
	if got := shared(marco); len(got) != 0 || got == nil {
		t.Fatalf("shared with Marco before = %#v, want an empty list", got)
	}

	s.must(t, s.do(t, giulia, http.MethodPut, path(hers.ID), `{"sharedWith":[2]}`), http.StatusNoContent)

	// Marco opens it and finds it among the lists shared with him, without
	// learning who else sees it; Anna does not know it is there.
	page := decode[Page](t, s.must(t, s.do(t, marco, http.MethodGet, path(hers.ID), ""), http.StatusOK))
	if page.Playlist.Name != "Compleanno" || len(page.Videos) != 1 || len(page.Playlist.SharedWith) != 0 {
		t.Errorf("Marco sees %+v %+v", page.Playlist, page.Videos)
	}
	if got := shared(marco); len(got) != 1 || got[0].ID != hers.ID || got[0].Videos != 1 {
		t.Errorf("shared with Marco = %+v", got)
	}
	s.must(t, s.do(t, anna, http.MethodGet, path(hers.ID), ""), http.StatusNotFound)
	if got := shared(anna); len(got) != 0 {
		t.Errorf("shared with Anna = %+v", got)
	}
	s.must(t, s.do(t, marco, http.MethodPut, path(hers.ID), `{"name":"Mia"}`), http.StatusForbidden)
	s.must(t, s.do(t, marco, http.MethodPut, path(hers.ID), `{"sharedWith":[3]}`), http.StatusForbidden)

	// Not on her channel, and in none of Marco's own lists.
	public := PublicLists(s.db, catalog.NewLookup(s.db))
	if got, err := public(context.Background(), giulia); err != nil || len(got) != 0 {
		t.Errorf("channel = %+v (%v), want nothing", got, err)
	}
	if lists := s.list(t, marco, ""); len(lists) != 1 {
		t.Errorf("Marco's own lists = %+v", lists)
	}

	// Giulia sees who, by name, in her lists and on the page.
	if got := s.list(t, giulia, "")[1].SharedWith; len(got) != 1 || got[0].Name != "Marco" {
		t.Errorf("Giulia's list shared with %+v", got)
	}
	s.must(t, s.do(t, giulia, http.MethodPut, path(hers.ID), `{"sharedWith":[3,2]}`), http.StatusNoContent)
	page = decode[Page](t, s.must(t, s.do(t, giulia, http.MethodGet, path(hers.ID), ""), http.StatusOK))
	if got := page.Playlist.SharedWith; len(got) != 2 || got[0].Name != "Anna" || got[1].Name != "Marco" {
		t.Errorf("shared with %+v, want Anna and Marco", got)
	}

	// Refusals change nothing, the name included.
	for name, body := range map[string]string{
		"herself":         `{"sharedWith":[1]}`,
		"someone unknown": `{"name":"Altro","sharedWith":[9]}`,
		"and public":      `{"public":true,"sharedWith":[2]}`,
		"not ids":         `{"sharedWith":"Marco"}`,
	} {
		if rec := s.do(t, giulia, http.MethodPut, path(hers.ID), body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400", name, rec.Code)
		}
	}
	if page := decode[Page](t, s.must(t, s.do(t, giulia, http.MethodGet, path(hers.ID), ""), http.StatusOK)); page.Playlist.Name != "Compleanno" ||
		len(page.Playlist.SharedWith) != 2 {
		t.Errorf("after refusals: %+v", page.Playlist)
	}

	// On the channel, everybody sees it: nobody is chosen any more.
	s.must(t, s.do(t, giulia, http.MethodPut, path(hers.ID), `{"public":true}`), http.StatusNoContent)
	if got := shared(marco); len(got) != 0 {
		t.Errorf("public: shared with Marco = %+v", got)
	}
	s.must(t, s.do(t, giulia, http.MethodPut, path(hers.ID), `{"public":false}`), http.StatusNoContent)
	s.must(t, s.do(t, marco, http.MethodGet, path(hers.ID), ""), http.StatusNotFound)

	// "Guarda più tardi" is never shared.
	later := s.list(t, giulia, "")[0]
	s.must(t, s.do(t, giulia, http.MethodPut, path(later.ID), `{"sharedWith":[2]}`), http.StatusConflict)
}

func TestRefused(t *testing.T) {
	s := newSite(t)
	gone := s.addVideo(t, "via")
	if _, err := s.db.Exec(`UPDATE videos SET missing_since = 1 WHERE id = ?`, gone); err != nil {
		t.Fatal(err)
	}
	list := s.create(t, giulia, "Lista")
	tests := []struct {
		name, method, target, body string
		user                       int64
		want                       int
	}{
		{"nobody logged in", http.MethodGet, "/api/playlists", "", 0, http.StatusUnauthorized},
		{"nobody creates", http.MethodPost, "/api/playlists", `{"name":"x"}`, 0, http.StatusUnauthorized},
		{"empty name", http.MethodPost, "/api/playlists", `{"name":"  "}`, giulia, http.StatusBadRequest},
		{"long name", http.MethodPost, "/api/playlists", `{"name":"` + strings.Repeat("a", 101) + `"}`, giulia, http.StatusBadRequest},
		{"not json", http.MethodPost, "/api/playlists", `Lista`, giulia, http.StatusBadRequest},
		{"other fields", http.MethodPost, "/api/playlists", `{"name":"x","kind":"later"}`, giulia, http.StatusBadRequest},
		{"bad video query", http.MethodGet, "/api/playlists?video=x", "", giulia, http.StatusBadRequest},
		{"bad list id", http.MethodGet, "/api/playlists/x", "", giulia, http.StatusNotFound},
		{"unknown list", http.MethodGet, path(999), "", giulia, http.StatusNotFound},
		{"unknown video", http.MethodPut, path(list.ID, 999), "", giulia, http.StatusNotFound},
		{"missing video", http.MethodPut, path(list.ID, gone), "", giulia, http.StatusNotFound},
		{"bad video id", http.MethodPut, path(list.ID) + "/videos/x", "", giulia, http.StatusNotFound},
		{"rename empty", http.MethodPut, path(list.ID), `{"name":""}`, giulia, http.StatusBadRequest},
		{"change nothing", http.MethodPut, path(list.ID), `{}`, giulia, http.StatusBadRequest},
		{"public not true or false", http.MethodPut, path(list.ID), `{"public":"yes"}`, giulia, http.StatusBadRequest},
	}
	for _, tt := range tests {
		if rec := s.do(t, tt.user, tt.method, tt.target, tt.body); rec.Code != tt.want {
			t.Errorf("%s: %d %s, want %d", tt.name, rec.Code, rec.Body, tt.want)
		}
	}
	page := decode[Page](t, s.must(t, s.do(t, giulia, http.MethodGet, path(list.ID), ""), http.StatusOK))
	if page.Playlist.Name != "Lista" || len(page.Videos) != 0 {
		t.Errorf("list changed: %+v", page)
	}
}

func TestLimits(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "mare")
	list := s.create(t, giulia, "Piena")
	// Fill the database directly: making thousands through the API is slow.
	if _, err := s.db.Exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
		INSERT INTO playlists (user_id, kind, name, created_at, updated_at) SELECT 1, 'playlist', 'p' || i, 1, 1 FROM n`,
		maxPlaylists-1); err != nil {
		t.Fatal(err)
	}
	s.must(t, s.do(t, giulia, http.MethodPost, "/api/playlists", `{"name":"Una di troppo"}`), http.StatusConflict)
	s.create(t, marco, "Marco ne ha ancora")

	for i := range maxVideos {
		if _, err := s.db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, category, added_at)
			VALUES (?, 1, ?, 1, 1, 'v', '', 1)`, "f"+strconv.Itoa(i), "p"+strconv.Itoa(i)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.db.Exec(`INSERT INTO playlist_items (playlist_id, video_id, position, added_at)
		SELECT ?, id, id, 1 FROM videos WHERE id <> ? LIMIT ?`, list.ID, video, maxVideos); err != nil {
		t.Fatal(err)
	}
	s.must(t, s.do(t, giulia, http.MethodPut, path(list.ID, video), ""), http.StatusConflict)
}
