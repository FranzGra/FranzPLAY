package likes

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/catalog"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// sameTime is the site's API with a clock that stands still, safe to call
// from many goroutines (the usual one moves at every like).
func (s *site) sameTime() *http.ServeMux {
	mux := http.NewServeMux()
	handlers{
		store:  store{db: s.db},
		videos: catalog.NewLookup(s.db),
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		now:    func() time.Time { return time.Unix(2_000_000, 0) },
		account: func(ctx context.Context) (users.Account, bool) {
			id, ok := ctx.Value(userKey{}).(int64)
			return users.Account{ID: id}, ok
		},
	}.routes(mux)
	return mux
}

func send(mux *http.ServeMux, user int64, method string, video int64) int {
	req := httptest.NewRequest(method, "/api/videos/"+strconv.FormatInt(video, 10)+"/like", nil)
	req = req.WithContext(context.WithValue(req.Context(), userKey{}, user))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec.Code
}

// Many people like the same video at the same moment, each with a double
// click: every like counts once.
func TestManyLikesAtOnce(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "festa.mp4")
	const people = 30
	for id := 3; id <= people; id++ {
		if _, err := s.db.Exec(`INSERT INTO users (id, name, password_hash, role, created_at) VALUES (?, ?, 'x', 'user', 1)`,
			id, "persona"+strconv.Itoa(id)); err != nil {
			t.Fatal(err)
		}
	}
	mux := s.sameTime()
	codes := make(chan int, people*2)
	var wg sync.WaitGroup
	for id := int64(1); id <= people; id++ {
		for range 2 {
			wg.Go(func() { codes <- send(mux, id, http.MethodPut, video) })
		}
	}
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != http.StatusOK {
			t.Fatalf("a like answered %d, want 200", code)
		}
	}
	if got := s.like(t, giulia, http.MethodGet, video); got != (Like{Liked: true, Count: people}) {
		t.Errorf("like = %+v, want liked by %d", got, people)
	}
}

// Like and unlike from two devices at once: whatever wins, what the
// person sees agrees with the count.
func TestLikeAndUnlikeFromTwoDevices(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "festa.mp4")
	mux := s.sameTime()
	var wg sync.WaitGroup
	for _, method := range []string{http.MethodPut, http.MethodDelete} {
		wg.Go(func() {
			for range 50 {
				if code := send(mux, giulia, method, video); code != http.StatusOK {
					t.Errorf("%s answered %d", method, code)
					return
				}
			}
		})
	}
	wg.Wait()
	got := s.like(t, giulia, http.MethodGet, video)
	want := int64(0)
	if got.Liked {
		want = 1
	}
	if got.Count != want {
		t.Errorf("like = %+v, count must be %d", got, want)
	}
	if mine := s.like(t, marco, http.MethodGet, video); mine.Liked {
		t.Errorf("Marco never liked it: %+v", mine)
	}
}

// The list of liked videos is each person's own, and asking past its end
// gives an empty page, not an error.
func TestLikedListIsMine(t *testing.T) {
	s := newSite(t)
	a := s.addVideo(t, "a.mp4")
	b := s.addVideo(t, "b.mp4")
	s.like(t, giulia, http.MethodPut, a)
	s.like(t, marco, http.MethodPut, b)
	if rec, list := s.liked(t, marco, ""); rec.Code != http.StatusOK || list.Total != 1 || len(list.Videos) != 1 ||
		list.Videos[0].ID != b {
		t.Errorf("Marco's likes = %d %+v, want only b", rec.Code, list)
	}
	if rec, list := s.liked(t, giulia, "offset=50"); rec.Code != http.StatusOK || list.Total != 1 ||
		list.Videos == nil || len(list.Videos) != 0 {
		t.Errorf("past the end = %d %+v, want an empty page of 1", rec.Code, list)
	}
	if rec, _ := s.liked(t, 0, ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("nobody logged in: %d", rec.Code)
	}
}

// A private video shared with me can be liked, and "Ti piacciono" shows
// it, in the list and in the total.
func TestLikedListHasTheVideosSharedWithMe(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "compleanno.mp4")
	for _, q := range []string{
		`UPDATE videos SET private = 1, uploaded_by = 1 WHERE id = ?`,
		`INSERT INTO video_shares (video_id, user_id) VALUES (?, 2)`,
	} {
		if _, err := s.db.Exec(q, video); err != nil {
			t.Fatal(err)
		}
	}
	s.like(t, marco, http.MethodPut, video)
	if _, list := s.liked(t, marco, ""); list.Total != 1 || len(list.Videos) != 1 {
		t.Errorf("Marco's likes = %+v, want the shared video", list)
	}
}
