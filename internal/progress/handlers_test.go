package progress

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

// site is the progress API on a fresh database, with two people.
type site struct {
	db  *sql.DB
	h   handlers
	mux *http.ServeMux
	now time.Time
}

const (
	giulia int64 = 1
	marco  int64 = 2
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
		`INSERT INTO users (id, name, password_hash, role, created_at) VALUES (1, 'Giulia', 'x', 'admin', 1), (2, 'Marco', 'x', 'user', 1)`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	s := &site{db: db, mux: http.NewServeMux(), now: time.Unix(1_000_000, 0)}
	s.h = handlers{
		store:  store{db: db},
		videos: catalog.NewLookup(db),
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		now:    func() time.Time { return s.now },
		account: func(ctx context.Context) (users.Account, bool) {
			id, ok := ctx.Value(userKey{}).(int64)
			return users.Account{ID: id}, ok
		},
	}
	s.h.routes(s.mux)
	return s
}

type userKey struct{}

// addVideo adds a present video; duration 0 means not read yet.
func (s *site) addVideo(t *testing.T, name string, duration int64) int64 {
	t.Helper()
	var d any
	if duration > 0 {
		d = duration
	}
	res, err := s.db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, folder_category, added_at, duration)
		VALUES (?, 1, ?, 1, 1, ?, '', 1, ?)`, "fp-"+name, name, name, d)
	if err != nil {
		t.Fatal(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// do sends a request as user (0 = nobody logged in).
func (s *site) do(t *testing.T, user int64, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if user != 0 {
		req = req.WithContext(context.WithValue(req.Context(), userKey{}, user))
	}
	rec := httptest.NewRecorder()
	s.mux.ServeHTTP(rec, req)
	return rec
}

func (s *site) save(t *testing.T, user, video int64, position string) *httptest.ResponseRecorder {
	t.Helper()
	return s.do(t, user, http.MethodPost, "/api/videos/"+strconv.FormatInt(video, 10)+"/progress", `{"position":`+position+`}`)
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.NewDecoder(rec.Body).Decode(&v); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return v
}

func TestSaveAndGetProgress(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "mare.mp4", 600)
	target := "/api/videos/" + strconv.FormatInt(video, 10) + "/progress"

	if got := decode[Mark](t, s.do(t, giulia, http.MethodGet, target, "")); got != (Mark{}) {
		t.Errorf("never watched: %+v, want zero", got)
	}
	if rec := s.save(t, giulia, video, "125.7"); rec.Code != http.StatusOK {
		t.Fatalf("save: %d %s", rec.Code, rec.Body)
	}
	if got := decode[Mark](t, s.do(t, giulia, http.MethodGet, target, "")); got != (Mark{Position: 125}) {
		t.Errorf("after saving: %+v", got)
	}
	// Saving again replaces the mark.
	s.save(t, giulia, video, "300")
	if got := decode[Mark](t, s.do(t, giulia, http.MethodGet, target, "")); got != (Mark{Position: 300}) {
		t.Errorf("after saving again: %+v", got)
	}
	// Each person has their own.
	if got := decode[Mark](t, s.do(t, marco, http.MethodGet, target, "")); got != (Mark{}) {
		t.Errorf("Marco sees %+v, want zero", got)
	}
	// Near the end the video is finished.
	if got := decode[Mark](t, s.save(t, giulia, video, "590")); got != (Mark{Finished: true}) {
		t.Errorf("near the end: %+v", got)
	}
}

func TestSaveProgressRejects(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "mare.mp4", 600)
	gone := s.addVideo(t, "via.mp4", 600)
	if _, err := s.db.Exec(`UPDATE videos SET missing_since = 1 WHERE id = ?`, gone); err != nil {
		t.Fatal(err)
	}
	path := func(id int64) string { return "/api/videos/" + strconv.FormatInt(id, 10) + "/progress" }
	tests := []struct {
		name   string
		user   int64
		target string
		body   string
		want   int
	}{
		{"nobody logged in", 0, path(video), `{"position":5}`, http.StatusUnauthorized},
		{"unknown video", giulia, path(999), `{"position":50}`, http.StatusNotFound},
		{"missing video", giulia, path(gone), `{"position":50}`, http.StatusNotFound},
		{"bad id", giulia, "/api/videos/abc/progress", `{"position":50}`, http.StatusNotFound},
		{"negative", giulia, path(video), `{"position":-1}`, http.StatusBadRequest},
		{"too far", giulia, path(video), `{"position":1e9}`, http.StatusBadRequest},
		{"text", giulia, path(video), `{"position":"50"}`, http.StatusBadRequest},
		{"other fields", giulia, path(video), `{"position":50,"finished":true}`, http.StatusBadRequest},
		{"not json", giulia, path(video), `50`, http.StatusBadRequest},
		{"too big", giulia, path(video), `{"position":50` + strings.Repeat(" ", 2000) + `}`, http.StatusBadRequest},
	}
	for _, tt := range tests {
		if rec := s.do(t, tt.user, http.MethodPost, tt.target, tt.body); rec.Code != tt.want {
			t.Errorf("%s: %d %s, want %d", tt.name, rec.Code, rec.Body, tt.want)
		}
	}
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM watch_progress`).Scan(&n); err != nil || n != 0 {
		t.Errorf("rows saved = %d (%v), want 0", n, err)
	}
}

func TestSaveProgressOfVideoNotReadYet(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "nuovo.mkv", 0)
	if got := decode[Mark](t, s.save(t, giulia, video, "42")); got != (Mark{Position: 42}) {
		t.Errorf("mark = %+v, want position 42", got)
	}
}

func TestContinueWatching(t *testing.T) {
	s := newSite(t)
	first := s.addVideo(t, "primo.mp4", 600)
	second := s.addVideo(t, "secondo.mp4", 600)
	finished := s.addVideo(t, "finito.mp4", 600)
	barely := s.addVideo(t, "appena.mp4", 600)
	gone := s.addVideo(t, "sparito.mp4", 600)

	for _, step := range []struct {
		video    int64
		position string
	}{{first, "100"}, {gone, "100"}, {second, "200"}, {finished, "599"}, {barely, "3"}} {
		s.now = s.now.Add(time.Minute)
		if rec := s.save(t, giulia, step.video, step.position); rec.Code != http.StatusOK {
			t.Fatalf("save: %d %s", rec.Code, rec.Body)
		}
	}
	s.save(t, marco, first, "50")
	if _, err := s.db.Exec(`UPDATE videos SET missing_since = 1 WHERE id = ?`, gone); err != nil {
		t.Fatal(err)
	}

	items := decode[[]struct {
		Video    catalog.Video `json:"video"`
		Position int64         `json:"position"`
	}](t, s.do(t, giulia, http.MethodGet, "/api/continue", ""))
	// Most recent first; finished, just started and missing videos left out.
	if len(items) != 2 || items[0].Video.ID != second || items[0].Position != 200 ||
		items[1].Video.ID != first || items[1].Position != 100 {
		t.Errorf("items = %+v", items)
	}

	if rec := s.do(t, 0, http.MethodGet, "/api/continue", ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("nobody logged in: %d", rec.Code)
	}
}

func TestContinueWatchingEmpty(t *testing.T) {
	s := newSite(t)
	rec := s.do(t, giulia, http.MethodGet, "/api/continue", "")
	if body := strings.TrimSpace(rec.Body.String()); rec.Code != http.StatusOK || body != "[]" {
		t.Errorf("got %d %s, want 200 []", rec.Code, body)
	}
}

func TestProgressGoesWithTheVideo(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "mare.mp4", 600)
	s.save(t, giulia, video, "100")
	if _, err := s.db.Exec(`DELETE FROM videos WHERE id = ?`, video); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM watch_progress`).Scan(&n); err != nil || n != 0 {
		t.Errorf("rows left = %d (%v), want 0", n, err)
	}
}

type historyAnswer struct {
	Items []struct {
		Video     catalog.Video `json:"video"`
		Position  int64         `json:"position"`
		Finished  bool          `json:"finished"`
		WatchedAt time.Time     `json:"watchedAt"`
	} `json:"items"`
	Total int `json:"total"`
}

func TestHistory(t *testing.T) {
	s := newSite(t)
	first := s.addVideo(t, "primo.mp4", 600)
	finished := s.addVideo(t, "finito.mp4", 600)
	gone := s.addVideo(t, "sparito.mp4", 600)
	last := s.addVideo(t, "ultimo.mp4", 600)
	for _, step := range []struct {
		video    int64
		position string
	}{{first, "100"}, {finished, "599"}, {gone, "50"}, {last, "3"}} {
		s.now = s.now.Add(time.Minute)
		s.save(t, giulia, step.video, step.position)
	}
	s.save(t, marco, first, "50")
	if _, err := s.db.Exec(`UPDATE videos SET missing_since = 1 WHERE id = ?`, gone); err != nil {
		t.Fatal(err)
	}

	got := decode[historyAnswer](t, s.do(t, giulia, http.MethodGet, "/api/history", ""))
	// Everything watched, finished or barely started, most recent first;
	// missing videos are left out.
	if got.Total != 3 || len(got.Items) != 3 {
		t.Fatalf("history = %+v, want 3 videos", got)
	}
	want := []struct {
		id       int64
		position int64
		finished bool
		minute   int64
	}{{last, 0, false, 4}, {finished, 0, true, 2}, {first, 100, false, 1}}
	for i, w := range want {
		it := got.Items[i]
		if it.Video.ID != w.id || it.Position != w.position || it.Finished != w.finished ||
			!it.WatchedAt.Equal(time.Unix(1_000_000+60*w.minute, 0)) {
			t.Errorf("item %d = %+v, want %+v", i, it, w)
		}
	}

	page := decode[historyAnswer](t, s.do(t, giulia, http.MethodGet, "/api/history?limit=1&offset=1", ""))
	if page.Total != 3 || len(page.Items) != 1 || page.Items[0].Video.ID != finished {
		t.Errorf("second page = %+v", page)
	}

	for _, target := range []string{"/api/history?limit=0", "/api/history?limit=201", "/api/history?offset=-1", "/api/history?offset=x"} {
		if rec := s.do(t, giulia, http.MethodGet, target, ""); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400", target, rec.Code)
		}
	}
	if rec := s.do(t, 0, http.MethodGet, "/api/history", ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("nobody logged in: %d", rec.Code)
	}
}

func TestHistoryEmpty(t *testing.T) {
	s := newSite(t)
	rec := s.do(t, giulia, http.MethodGet, "/api/history", "")
	if body := strings.TrimSpace(rec.Body.String()); rec.Code != http.StatusOK || body != `{"items":[],"total":0}` {
		t.Errorf("got %d %s", rec.Code, body)
	}
}

func TestForgetHistory(t *testing.T) {
	s := newSite(t)
	a := s.addVideo(t, "a.mp4", 600)
	b := s.addVideo(t, "b.mp4", 600)
	for _, v := range []int64{a, b} {
		s.save(t, giulia, v, "100")
		s.save(t, marco, v, "100")
	}
	count := func(user int64) int {
		return decode[historyAnswer](t, s.do(t, user, http.MethodGet, "/api/history", "")).Total
	}

	if rec := s.do(t, giulia, http.MethodDelete, "/api/history/"+strconv.FormatInt(a, 10), ""); rec.Code != http.StatusNoContent {
		t.Fatalf("forget one: %d %s", rec.Code, rec.Body)
	}
	if count(giulia) != 1 || count(marco) != 2 {
		t.Errorf("after forgetting one: Giulia %d, Marco %d", count(giulia), count(marco))
	}
	// The video starts again from the beginning.
	target := "/api/videos/" + strconv.FormatInt(a, 10) + "/progress"
	if got := decode[Mark](t, s.do(t, giulia, http.MethodGet, target, "")); got != (Mark{}) {
		t.Errorf("forgotten video: %+v", got)
	}
	if rec := s.do(t, giulia, http.MethodDelete, "/api/history/"+strconv.FormatInt(a, 10), ""); rec.Code != http.StatusNotFound {
		t.Errorf("forget again: %d, want 404", rec.Code)
	}

	if rec := s.do(t, giulia, http.MethodDelete, "/api/history", ""); rec.Code != http.StatusNoContent {
		t.Fatalf("forget all: %d %s", rec.Code, rec.Body)
	}
	if count(giulia) != 0 || count(marco) != 2 {
		t.Errorf("after forgetting all: Giulia %d, Marco %d", count(giulia), count(marco))
	}
	if rec := s.do(t, 0, http.MethodDelete, "/api/history", ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("nobody logged in: %d", rec.Code)
	}
}

func TestLeaveContinueWatching(t *testing.T) {
	s := newSite(t)
	a := s.addVideo(t, "a.mp4", 600)
	b := s.addVideo(t, "b.mp4", 600)
	for _, v := range []int64{a, b} {
		s.save(t, giulia, v, "100")
	}
	s.save(t, marco, a, "100")
	continuing := func(user int64) []int64 {
		items := decode[[]struct {
			Video catalog.Video `json:"video"`
		}](t, s.do(t, user, http.MethodGet, "/api/continue", ""))
		ids := []int64{}
		for _, it := range items {
			ids = append(ids, it.Video.ID)
		}
		return ids
	}
	leave := func(user, video int64) int {
		return s.do(t, user, http.MethodDelete, "/api/continue/"+strconv.FormatInt(video, 10), "").Code
	}

	if code := leave(giulia, a); code != http.StatusNoContent {
		t.Fatalf("leave: %d", code)
	}
	if got := continuing(giulia); len(got) != 1 || got[0] != b {
		t.Errorf("Giulia continues %v, want only b", got)
	}
	if got := continuing(marco); len(got) != 1 || got[0] != a {
		t.Errorf("Marco continues %v, want his a", got)
	}
	// The history keeps it, with where Giulia stopped.
	if h := decode[historyAnswer](t, s.do(t, giulia, http.MethodGet, "/api/history", "")); h.Total != 2 {
		t.Errorf("history total = %d, want 2", h.Total)
	}
	target := "/api/videos/" + strconv.FormatInt(a, 10) + "/progress"
	if got := decode[Mark](t, s.do(t, giulia, http.MethodGet, target, "")); got.Position != 100 {
		t.Errorf("progress = %+v, want 100", got)
	}
	if code := leave(giulia, a); code != http.StatusNotFound {
		t.Errorf("leave again: %d, want 404", code)
	}

	// Watching it again puts it back.
	s.now = s.now.Add(time.Minute)
	s.save(t, giulia, a, "150")
	if got := continuing(giulia); len(got) != 2 || got[0] != a {
		t.Errorf("after watching again: %v, want a first", got)
	}

	tests := []struct {
		name  string
		user  int64
		video string
		want  int
	}{
		{"nobody logged in", 0, strconv.FormatInt(b, 10), http.StatusUnauthorized},
		{"never watched", marco, strconv.FormatInt(b, 10), http.StatusNotFound},
		{"bad id", giulia, "zero", http.StatusNotFound},
	}
	for _, tt := range tests {
		if rec := s.do(t, tt.user, http.MethodDelete, "/api/continue/"+tt.video, ""); rec.Code != tt.want {
			t.Errorf("%s: %d, want %d", tt.name, rec.Code, tt.want)
		}
	}
}
