package playlists

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
)

func (s *site) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := s.db.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

// ids returns the videos of a list as user sees them, in order.
func (s *site) ids(t *testing.T, user, list int64) []int64 {
	t.Helper()
	page := decode[Page](t, s.must(t, s.do(t, user, http.MethodGet, path(list), ""), http.StatusOK))
	out := []int64{}
	for _, v := range page.Videos {
		out = append(out, v.ID)
	}
	return out
}

func sameIDs(a, b []int64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// A video taken out and put back goes to the end; the others keep their
// place.
func TestOrderAfterTakingOut(t *testing.T) {
	s := newSite(t)
	a, b, c, d := s.addVideo(t, "a"), s.addVideo(t, "b"), s.addVideo(t, "c"), s.addVideo(t, "d")
	list := s.create(t, giulia, "Ordine")
	for _, v := range []int64{a, b, c, d} {
		s.must(t, s.do(t, giulia, http.MethodPut, path(list.ID, v), ""), http.StatusNoContent)
	}
	s.must(t, s.do(t, giulia, http.MethodDelete, path(list.ID, b), ""), http.StatusNoContent)
	if got := s.ids(t, giulia, list.ID); !sameIDs(got, []int64{a, c, d}) {
		t.Errorf("after taking b out: %v", got)
	}
	s.must(t, s.do(t, giulia, http.MethodPut, path(list.ID, b), ""), http.StatusNoContent)
	if got := s.ids(t, giulia, list.ID); !sameIDs(got, []int64{a, c, d, b}) {
		t.Errorf("after putting b back: %v, want it last", got)
	}
	// Taking out a video that is not there changes nothing.
	s.must(t, s.do(t, giulia, http.MethodDelete, path(list.ID, 999), ""), http.StatusNoContent)
	if got := s.ids(t, giulia, list.ID); !sameIDs(got, []int64{a, c, d, b}) {
		t.Errorf("after taking out a stranger: %v", got)
	}
}

// A video deleted from the library leaves every list; the cover becomes
// the next video. A missing one is hidden and comes back in its place.
func TestVideosLeavingTheLibrary(t *testing.T) {
	s := newSite(t)
	a, b, c := s.addVideo(t, "a"), s.addVideo(t, "b"), s.addVideo(t, "c")
	hers := s.create(t, giulia, "Sua")
	his := s.create(t, marco, "Mia")
	for _, v := range []int64{a, b, c} {
		s.must(t, s.do(t, giulia, http.MethodPut, path(hers.ID, v), ""), http.StatusNoContent)
		s.must(t, s.do(t, marco, http.MethodPut, path(his.ID, v), ""), http.StatusNoContent)
	}

	s.exec(t, `UPDATE videos SET missing_since = 1 WHERE id = ?`, a)
	page := decode[Page](t, s.must(t, s.do(t, giulia, http.MethodGet, path(hers.ID), ""), http.StatusOK))
	if page.Playlist.Videos != 2 || page.Playlist.Cover == nil || *page.Playlist.Cover != "/api/covers/b.jpg" {
		t.Errorf("with a missing: %+v, want 2 videos and b's cover", page.Playlist)
	}
	// Adding it again while missing is refused, and does not move it.
	s.must(t, s.do(t, giulia, http.MethodPut, path(hers.ID, a), ""), http.StatusNotFound)
	s.exec(t, `UPDATE videos SET missing_since = NULL WHERE id = ?`, a)
	if got := s.ids(t, giulia, hers.ID); !sameIDs(got, []int64{a, b, c}) {
		t.Errorf("back from the disk: %v, want a first again", got)
	}

	s.exec(t, `DELETE FROM videos WHERE id = ?`, b)
	for _, l := range []struct{ user, list int64 }{{giulia, hers.ID}, {marco, his.ID}} {
		if got := s.ids(t, l.user, l.list); !sameIDs(got, []int64{a, c}) {
			t.Errorf("list %d after deleting b: %v", l.list, got)
		}
	}
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM playlist_items WHERE video_id = ?`, b).Scan(&n); err != nil || n != 0 {
		t.Errorf("items of the deleted video = %d (%v), want 0", n, err)
	}

	// Every video gone: an empty list with no cover.
	s.exec(t, `DELETE FROM videos`)
	page = decode[Page](t, s.must(t, s.do(t, giulia, http.MethodGet, path(hers.ID), ""), http.StatusOK))
	if page.Playlist.Videos != 0 || page.Playlist.Cover != nil || len(page.Videos) != 0 {
		t.Errorf("all gone: %+v %+v", page.Playlist, page.Videos)
	}
}

// Names are kept as typed: accents, emoji and markup are only text. The
// limit counts characters, not bytes.
func TestNamesAreText(t *testing.T) {
	s := newSite(t)
	for _, name := range []string{
		"Città e montagne è già",
		"🎬 Film 🍿 della sera 👨‍👩‍👧",
		`<script>alert("x")</script> & <b>grassetto</b>`,
		`C:\Video\Vacanze 2024`,
		"日本の旅",
		strings.Repeat("é", maxNameLen),
		strings.Repeat("😀", maxNameLen),
	} {
		created := s.create(t, giulia, name)
		if created.Name != name {
			t.Errorf("created %q, want %q", created.Name, name)
		}
		page := decode[Page](t, s.must(t, s.do(t, giulia, http.MethodGet, path(created.ID), ""), http.StatusOK))
		if page.Playlist.Name != name {
			t.Errorf("read back %q, want %q", page.Playlist.Name, name)
		}
	}
	for _, name := range []string{strings.Repeat("😀", maxNameLen+1), "\x00\x01"} {
		body, err := json.Marshal(nameRequest{Name: name})
		if err != nil {
			t.Fatal(err)
		}
		if rec := s.do(t, giulia, http.MethodPost, "/api/playlists", string(body)); rec.Code != http.StatusBadRequest {
			t.Errorf("name %q: %d, want 400", name, rec.Code)
		}
	}
}

// Two devices fill the same list at once: every video is there once, in
// a fixed order, with no two in the same place.
func TestFillingFromTwoDevicesAtOnce(t *testing.T) {
	s := newSite(t)
	list := s.create(t, giulia, "Insieme")
	videos := make([]int64, 40)
	for i := range videos {
		videos[i] = s.addVideo(t, "v"+strconv.Itoa(i))
	}
	// Requests made here, not with s.do: it moves the clock, and the
	// handlers read the clock from every goroutine.
	send := func(method, target string) int {
		req := httptest.NewRequest(method, target, nil)
		req = req.WithContext(context.WithValue(req.Context(), userKey{}, giulia))
		rec := httptest.NewRecorder()
		s.mux.ServeHTTP(rec, req)
		return rec.Code
	}
	codes := make(chan int, 4*len(videos))
	var wg sync.WaitGroup
	for device := range 4 {
		wg.Go(func() {
			// Each device adds every video: two of them in one order,
			// two in the other, so the same video often arrives twice.
			for i := range videos {
				v := videos[i]
				if device%2 == 1 {
					v = videos[len(videos)-1-i]
				}
				codes <- send(http.MethodPut, path(list.ID, v))
			}
		})
	}
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != http.StatusNoContent {
			t.Fatalf("an add answered %d, want 204", code)
		}
	}
	var items, places int
	if err := s.db.QueryRow(`SELECT count(*), count(DISTINCT position) FROM playlist_items WHERE playlist_id = ?`,
		list.ID).Scan(&items, &places); err != nil {
		t.Fatal(err)
	}
	if items != len(videos) || places != len(videos) {
		t.Errorf("items = %d in %d places, want %d in %d", items, places, len(videos), len(videos))
	}
	first := s.ids(t, giulia, list.ID)
	if again := s.ids(t, giulia, list.ID); !sameIDs(first, again) {
		t.Errorf("the order changed between two reads: %v, then %v", first, again)
	}
}

// Someone else's list cannot be read or changed, even knowing its id, and
// a list shared with me stays read-only for me.
func TestOthersListsStayTheirs(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "mare")
	hers := s.create(t, giulia, "Condivisa")
	s.must(t, s.do(t, giulia, http.MethodPut, path(hers.ID, video), ""), http.StatusNoContent)
	s.must(t, s.do(t, giulia, http.MethodPut, path(hers.ID), `{"sharedWith":[2]}`), http.StatusNoContent)
	later := s.list(t, giulia, "")[0]

	// Marco sees the shared list, but may not change it.
	s.must(t, s.do(t, marco, http.MethodGet, path(hers.ID), ""), http.StatusOK)
	for _, r := range []struct{ method, target, body string }{
		{http.MethodPut, path(hers.ID), `{"name":"Mia"}`},
		{http.MethodPut, path(hers.ID), `{"sharedWith":[]}`},
		{http.MethodDelete, path(hers.ID), ""},
		{http.MethodPut, path(hers.ID, video), ""},
		{http.MethodDelete, path(hers.ID, video), ""},
	} {
		if rec := s.do(t, marco, r.method, r.target, r.body); rec.Code != http.StatusForbidden {
			t.Errorf("Marco %s %s: %d, want 403", r.method, r.target, rec.Code)
		}
	}
	// Her "Guarda più tardi" is never someone else's business.
	for _, r := range []struct{ method, target string }{
		{http.MethodGet, path(later.ID)},
		{http.MethodPut, path(later.ID, video)},
	} {
		if rec := s.do(t, marco, r.method, r.target, ""); rec.Code != http.StatusNotFound {
			t.Errorf("Marco %s her watch later: %d, want 404", r.method, rec.Code)
		}
	}
	if got := s.ids(t, giulia, hers.ID); !sameIDs(got, []int64{video}) {
		t.Errorf("Giulia's list changed: %v", got)
	}
	// Taking the share back hides the list again.
	s.must(t, s.do(t, giulia, http.MethodPut, path(hers.ID), `{"sharedWith":[]}`), http.StatusNoContent)
	s.must(t, s.do(t, marco, http.MethodGet, path(hers.ID), ""), http.StatusNotFound)
}
