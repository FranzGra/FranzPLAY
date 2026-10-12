package catalog

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/users"
)

// adminSite is a catalog with the administrator's API on top, for who.
type adminSite struct {
	*site
	admin           http.Handler
	who             users.Account
	changed, queued int
}

func newAdminSite(t *testing.T) *adminSite {
	t.Helper()
	s := &adminSite{site: newSite(t), who: users.Account{ID: 1, Name: "Admin", Role: users.Admin}}
	mux := http.NewServeMux()
	admin{
		store: store{db: s.db}, changed: func() { s.changed++ }, queued: func() { s.queued++ },
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		now:    func() time.Time { return time.Unix(1000, 0) },
		account: func(context.Context) (users.Account, bool) {
			return s.who, s.who.ID != 0
		},
	}.routes(mux)
	s.admin = mux
	return s
}

func (s *adminSite) do(t *testing.T, method, target, body string, want int) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	s.admin.ServeHTTP(rec, httptest.NewRequest(method, target, bytes.NewBufferString(body)))
	if rec.Code != want {
		t.Fatalf("%s %s = %d, want %d; body %s", method, target, rec.Code, want, rec.Body)
	}
	return rec
}

func TestHiddenVideosAreSeenByNobody(t *testing.T) {
	s := newAdminSite(t)
	shown := s.addVideo(t, "Viaggi/mare.mp4", "sea", "Viaggi", 100, true)
	hidden := s.addVideo(t, "Viaggi/segreto.mp4", "secret", "Viaggi", 200, true)

	s.do(t, "PUT", "/api/admin/videos/"+strconv.FormatInt(hidden, 10)+"/hidden", `{"hidden":true}`, http.StatusNoContent)
	if s.changed != 1 {
		t.Errorf("pages told %d times, want 1", s.changed)
	}

	got := decode[listResponse](t, s.get(t, "/api/videos"))
	if got.Total != 1 || got.Videos[0].ID != shown {
		t.Errorf("list = %+v, want only the shown video", got)
	}
	if rec := s.get(t, "/api/videos/"+strconv.FormatInt(hidden, 10)); rec.Code != http.StatusNotFound {
		t.Errorf("GET hidden video = %d, want 404", rec.Code)
	}
	if rec := s.get(t, "/api/videos/"+strconv.FormatInt(hidden, 10)+"/stream"); rec.Code != http.StatusNotFound {
		t.Errorf("stream of a hidden video = %d, want 404", rec.Code)
	}
	if cats := decode[[]Category](t, s.get(t, "/api/categories")); len(cats) != 1 || cats[0].Videos != 1 {
		t.Errorf("categories = %+v, want Viaggi with 1 video", cats)
	}

	// Shown again: everything comes back.
	s.do(t, "PUT", "/api/admin/videos/"+strconv.FormatInt(hidden, 10)+"/hidden", `{"hidden":false}`, http.StatusNoContent)
	if got := decode[listResponse](t, s.get(t, "/api/videos")); got.Total != 2 {
		t.Errorf("after showing again: %d videos, want 2", got.Total)
	}
}

func TestHideRefusals(t *testing.T) {
	s := newAdminSite(t)
	id := strconv.FormatInt(s.addVideo(t, "a.mp4", "a", "", 1, false), 10)
	for name, body := range map[string]string{
		"empty":         ``,
		"no field":      `{}`,
		"not a bool":    `{"hidden":"yes"}`,
		"unknown field": `{"hidden":true,"forever":true}`,
	} {
		rec := httptest.NewRecorder()
		s.admin.ServeHTTP(rec, httptest.NewRequest("PUT", "/api/admin/videos/"+id+"/hidden", bytes.NewBufferString(body)))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", name, rec.Code)
		}
	}
	s.do(t, "PUT", "/api/admin/videos/999/hidden", `{"hidden":true}`, http.StatusNotFound)
	s.do(t, "PUT", "/api/admin/videos/abc/hidden", `{"hidden":true}`, http.StatusNotFound)
}

func TestAdminList(t *testing.T) {
	s := newAdminSite(t)
	mare := s.addVideo(t, "Viaggi/mare.mp4", "sea", "Viaggi", 100, true)
	gone := s.addVideo(t, "vecchio.mp4", "old", "", 200, false)
	secret := s.addVideo(t, "segreto.mp4", "secret", "", 300, false)
	if _, err := s.db.Exec(`UPDATE videos SET missing_since = 1 WHERE id = ?`, gone); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE videos SET hidden_at = 1 WHERE id = ?`, secret); err != nil {
		t.Fatal(err)
	}

	all := decode[adminList](t, s.do(t, "GET", "/api/admin/videos", "", http.StatusOK))
	if all.Total != 3 || len(all.Videos) != 3 {
		t.Fatalf("all = %+v", all)
	}
	if all.Videos[0].ID != secret {
		t.Errorf("first video = %d, want the newest (%d)", all.Videos[0].ID, secret)
	}
	byID := map[int64]AdminVideo{}
	for _, v := range all.Videos {
		byID[v.ID] = v
	}
	if v := byID[secret]; !v.Hidden || v.Missing {
		t.Errorf("hidden video = %+v", v)
	}
	if v := byID[gone]; v.Hidden || !v.Missing {
		t.Errorf("missing video = %+v", v)
	}
	if v := byID[mare]; v.Hidden || v.Missing || v.Folder != s.library || v.Path != "Viaggi/mare.mp4" || v.Cover == nil {
		t.Errorf("normal video = %+v", v)
	}

	for show, want := range map[string]int64{"hidden": secret, "missing": gone} {
		got := decode[adminList](t, s.do(t, "GET", "/api/admin/videos?show="+show, "", http.StatusOK))
		if got.Total != 1 || got.Videos[0].ID != want {
			t.Errorf("show=%s: %+v", show, got)
		}
	}
	// The search also looks in the file's path.
	got := decode[adminList](t, s.do(t, "GET", "/api/admin/videos?q=viaggi%2Fmare", "", http.StatusOK))
	if got.Total != 1 || got.Videos[0].ID != mare {
		t.Errorf("search by path = %+v", got)
	}
	s.do(t, "GET", "/api/admin/videos?show=everything", "", http.StatusBadRequest)
}

func TestRefresh(t *testing.T) {
	s := newAdminSite(t)
	id := s.addVideo(t, "a.mp4", "a", "", 1, true)
	gone := s.addVideo(t, "b.mp4", "b", "", 2, false)
	if _, err := s.db.Exec(`UPDATE videos SET missing_since = 1 WHERE id = ?`, gone); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`INSERT INTO jobs (video_id, kind, state, attempts, updated_at) VALUES (?, 'cover', 'done', 1, 1)`, id); err != nil {
		t.Fatal(err)
	}

	s.do(t, "POST", "/api/admin/videos/"+strconv.FormatInt(id, 10)+"/refresh", "", http.StatusNoContent)
	if s.queued != 1 {
		t.Errorf("worker told %d times, want 1", s.queued)
	}
	rows, err := s.db.Query(`SELECT kind FROM jobs WHERE video_id = ? AND state = 'pending' AND attempts = 0 ORDER BY kind`, id)
	if err != nil {
		t.Fatal(err)
	}
	var kinds []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			t.Fatal(err)
		}
		kinds = append(kinds, k)
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(kinds, []string{"convert", "cover", "details", "preview", "probe", "tracks"}) {
		t.Errorf("pending jobs = %v, want convert, cover, preview, probe and tracks", kinds)
	}

	s.do(t, "POST", "/api/admin/videos/"+strconv.FormatInt(gone, 10)+"/refresh", "", http.StatusConflict)
	s.do(t, "POST", "/api/admin/videos/999/refresh", "", http.StatusNotFound)
}

func TestVideosAdminIsForAdministrators(t *testing.T) {
	s := newAdminSite(t)
	s.who = users.Account{ID: 2, Name: "Giulia", Role: users.User}
	s.do(t, "GET", "/api/admin/videos", "", http.StatusForbidden)
	s.do(t, "PUT", "/api/admin/videos/1/hidden", `{"hidden":true}`, http.StatusForbidden)
	s.do(t, "POST", "/api/admin/videos/1/refresh", "", http.StatusForbidden)
	s.who = users.Account{}
	s.do(t, "GET", "/api/admin/videos", "", http.StatusUnauthorized)
}
