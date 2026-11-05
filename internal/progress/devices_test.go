package progress

import (
	"encoding/json"
	"net/http"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/catalog"
)

// continuing returns the videos of "Continua a guardare" of user, in order,
// with where each one stopped.
func (s *site) continuing(t *testing.T, user int64) []item {
	t.Helper()
	rec := s.do(t, user, http.MethodGet, "/api/continue", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("continue: %d %s", rec.Code, rec.Body)
	}
	return decode[[]item](t, rec)
}

func (s *site) mark(t *testing.T, user, video int64) Mark {
	t.Helper()
	return decode[Mark](t, s.do(t, user, http.MethodGet, "/api/videos/"+strconv.FormatInt(video, 10)+"/progress", ""))
}

func (s *site) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := s.db.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

// The player saves every few seconds: hundreds of saves leave one row,
// with the last position.
func TestSavingOftenKeepsOneRow(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "film.mkv", 7200)
	for pos := 15; pos <= 3000; pos += 5 {
		s.now = s.now.Add(5 * time.Second)
		if rec := s.save(t, giulia, video, strconv.Itoa(pos)); rec.Code != http.StatusOK {
			t.Fatalf("save %d: %d %s", pos, rec.Code, rec.Body)
		}
	}
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM watch_progress`).Scan(&n); err != nil || n != 1 {
		t.Errorf("rows = %d (%v), want 1", n, err)
	}
	if got := s.mark(t, giulia, video); got != (Mark{Position: 3000}) {
		t.Errorf("mark = %+v, want 3000", got)
	}
	if h := decode[historyAnswer](t, s.do(t, giulia, http.MethodGet, "/api/history", "")); h.Total != 1 ||
		!h.Items[0].WatchedAt.Equal(s.now) {
		t.Errorf("history = %+v, want one video watched now", h)
	}
}

// Phone, television and computer save the same video at the same time,
// while someone else watches too: every save is answered, nothing is
// mixed between people, and the mark is one of the positions sent.
func TestSavingFromManyDevicesAtOnce(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "film.mkv", 7200)
	other := s.addVideo(t, "altro.mkv", 7200)

	const devices, saves = 6, 20
	sent := map[int64]bool{}
	for d := range devices {
		for i := range saves {
			sent[int64(100+d*1000+i)] = true
		}
	}
	codes := make(chan int, devices*saves*2)
	var wg sync.WaitGroup
	for d := range devices {
		wg.Go(func() {
			for i := range saves {
				codes <- s.save(t, giulia, video, strconv.Itoa(100+d*1000+i)).Code
				// Marco watches another video, and the same one, meanwhile.
				target := other
				if i%2 == 0 {
					target = video
				}
				codes <- s.save(t, marco, target, "50").Code
			}
		})
	}
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != http.StatusOK {
			t.Fatalf("a save answered %d, want 200", code)
		}
	}

	if got := s.mark(t, giulia, video); got.Finished || !sent[got.Position] {
		t.Errorf("Giulia's mark = %+v, not one of the positions sent", got)
	}
	for _, v := range []int64{video, other} {
		if got := s.mark(t, marco, v); got != (Mark{Position: 50}) {
			t.Errorf("Marco's mark of %d = %+v, want 50", v, got)
		}
	}
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM watch_progress`).Scan(&n); err != nil || n != 3 {
		t.Errorf("rows = %d (%v), want 3", n, err)
	}
}

// Reading "Continua a guardare" while the player saves never fails nor
// shows half a change.
func TestReadingWhileSaving(t *testing.T) {
	s := newSite(t)
	videos := make([]int64, 5)
	for i := range videos {
		videos[i] = s.addVideo(t, "v"+strconv.Itoa(i)+".mp4", 600)
		s.save(t, giulia, videos[i], "100")
	}
	var wg sync.WaitGroup
	errs := make(chan string, 200)
	wg.Go(func() {
		for i := range 100 {
			if rec := s.save(t, giulia, videos[i%len(videos)], strconv.Itoa(100+i)); rec.Code != http.StatusOK {
				errs <- "save: " + rec.Body.String()
			}
		}
	})
	wg.Go(func() {
		for range 50 {
			rec := s.do(t, giulia, http.MethodGet, "/api/continue", "")
			if rec.Code != http.StatusOK {
				errs <- "continue: " + rec.Body.String()
				continue
			}
			var items []item
			if err := json.NewDecoder(rec.Body).Decode(&items); err != nil || len(items) != len(videos) {
				errs <- "continue: " + rec.Body.String()
			}
		}
	})
	wg.Wait()
	close(errs)
	for e := range errs {
		t.Error(e)
	}
}

// A finished video leaves "Continua a guardare" but stays in the
// history; watching it again from the middle puts it back.
func TestFinishedVideoComesBackWhenWatchedAgain(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "film.mkv", 3600)
	s.save(t, giulia, video, "1200")
	s.now = s.now.Add(time.Hour)
	if got := decode[Mark](t, s.save(t, giulia, video, "3590")); got != (Mark{Finished: true}) {
		t.Fatalf("near the end: %+v, want finished", got)
	}
	if got := s.continuing(t, giulia); len(got) != 0 {
		t.Errorf("finished video still in continue: %+v", got)
	}
	h := decode[historyAnswer](t, s.do(t, giulia, http.MethodGet, "/api/history", ""))
	if h.Total != 1 || !h.Items[0].Finished {
		t.Errorf("history = %+v, want the video finished", h)
	}

	s.now = s.now.Add(24 * time.Hour)
	s.save(t, giulia, video, "600")
	if got := s.continuing(t, giulia); len(got) != 1 || got[0].Position != 600 || got[0].Finished {
		t.Errorf("watched again: %+v, want it back at 600", got)
	}
}

// A video moved to another folder keeps its id, and so where everyone
// stopped. A video gone from the disk is hidden, not forgotten: when the
// disk comes back, so does the mark.
func TestProgressOfMovedAndMissingVideos(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "vacanze/mare.mp4", 600)
	s.save(t, giulia, video, "200")

	s.exec(t, `UPDATE videos SET path = 'archivio/2024/mare.mp4' WHERE id = ?`, video)
	if got := s.continuing(t, giulia); len(got) != 1 || got[0].Video.ID != video || got[0].Position != 200 {
		t.Errorf("after the move: %+v", got)
	}

	s.exec(t, `UPDATE videos SET missing_since = 1 WHERE id = ?`, video)
	if got := s.continuing(t, giulia); len(got) != 0 {
		t.Errorf("missing video in continue: %+v", got)
	}
	// The mark itself is kept, ready for the disk to come back.
	if got := s.mark(t, giulia, video); got.Position != 200 {
		t.Errorf("mark of a missing video = %+v, want 200 kept", got)
	}
	if rec := s.save(t, giulia, video, "300"); rec.Code != http.StatusNotFound {
		t.Errorf("save on a missing video: %d, want 404", rec.Code)
	}

	s.exec(t, `UPDATE videos SET missing_since = NULL WHERE id = ?`, video)
	if got := s.continuing(t, giulia); len(got) != 1 || got[0].Position != 200 {
		t.Errorf("after the disk came back: %+v, want 200", got)
	}

	// A hidden video behaves like a missing one.
	s.exec(t, `UPDATE videos SET hidden_at = 1 WHERE id = ?`, video)
	if got := s.continuing(t, giulia); len(got) != 0 {
		t.Errorf("hidden video in continue: %+v", got)
	}
}

// "Continua a guardare" shows the 20 most recent; the history all of them.
func TestContinueShowsTheMostRecent(t *testing.T) {
	s := newSite(t)
	var ids []int64
	for i := range continueLimit + 5 {
		id := s.addVideo(t, "v"+strconv.Itoa(i)+".mp4", 600)
		ids = append(ids, id)
		s.now = s.now.Add(time.Minute)
		s.save(t, giulia, id, "100")
	}
	got := s.continuing(t, giulia)
	if len(got) != continueLimit {
		t.Fatalf("continue has %d videos, want %d", len(got), continueLimit)
	}
	for i, it := range got {
		if want := ids[len(ids)-1-i]; it.Video.ID != want {
			t.Errorf("item %d = %d, want %d", i, it.Video.ID, want)
		}
	}
	if h := decode[historyAnswer](t, s.do(t, giulia, http.MethodGet, "/api/history?limit=200", "")); h.Total != len(ids) ||
		len(h.Items) != len(ids) {
		t.Errorf("history = %d of %d, want all %d", len(h.Items), h.Total, len(ids))
	}
}

// Videos saved in the same second keep a fixed order, request after
// request: the newest id first.
func TestSameSecondKeepsAFixedOrder(t *testing.T) {
	s := newSite(t)
	var ids []int64
	for i := range 6 {
		id := s.addVideo(t, "v"+strconv.Itoa(i)+".mp4", 600)
		ids = append(ids, id)
		s.save(t, giulia, id, "100")
	}
	first := s.continuing(t, giulia)
	for i, it := range first {
		if want := ids[len(ids)-1-i]; it.Video.ID != want {
			t.Errorf("item %d = %d, want %d", i, it.Video.ID, want)
		}
	}
	for range 5 {
		again := s.continuing(t, giulia)
		for i := range again {
			if again[i].Video.ID != first[i].Video.ID {
				t.Fatalf("the order changed: %d at %d, was %d", again[i].Video.ID, i, first[i].Video.ID)
			}
		}
	}
}

// Forgetting a person's history touches nobody else's, and a person
// deleted takes their marks along.
func TestHistoryBelongsToItsPerson(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "film.mkv", 600)
	s.save(t, giulia, video, "100")
	s.save(t, marco, video, "300")
	if rec := s.do(t, marco, http.MethodDelete, "/api/continue/"+strconv.FormatInt(video, 10), ""); rec.Code != http.StatusNoContent {
		t.Fatalf("Marco leaves continue: %d", rec.Code)
	}
	if got := s.continuing(t, giulia); len(got) != 1 || got[0].Position != 100 {
		t.Errorf("Giulia's continue changed: %+v", got)
	}
	s.exec(t, `DELETE FROM users WHERE id = ?`, marco)
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM watch_progress WHERE user_id = ?`, marco).Scan(&n); err != nil || n != 0 {
		t.Errorf("Marco's rows = %d (%v), want 0", n, err)
	}
	if got := s.mark(t, giulia, video); got.Position != 100 {
		t.Errorf("Giulia's mark = %+v, want 100", got)
	}
}

// A private video shared with someone opens for them (catalog CanOpen),
// so its progress is saved and it is in their "Continua a guardare", as it
// is for its uploader.
func TestProgressOnASharedVideo(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "compleanno.mp4", 600)
	s.exec(t, `UPDATE videos SET private = 1, uploaded_by = ? WHERE id = ?`, giulia, video)
	s.exec(t, `INSERT INTO video_shares (video_id, user_id) VALUES (?, ?)`, video, marco)
	if ok, err := catalog.NewLookup(s.db).CanOpen(t.Context(), video, marco); err != nil || !ok {
		t.Fatalf("Marco cannot open the shared video (%v)", err)
	}
	if rec := s.save(t, marco, video, "200"); rec.Code != http.StatusOK {
		t.Errorf("Marco saves on a video shared with him: %d %s, want 200", rec.Code, rec.Body)
	}
	if rec := s.save(t, giulia, video, "200"); rec.Code != http.StatusOK {
		t.Errorf("Giulia saves on her own private video: %d %s, want 200", rec.Code, rec.Body)
	}
	if got := s.continuing(t, marco); len(got) != 1 || got[0].Video.ID != video {
		t.Errorf("Marco's continue = %+v, want the shared video", got)
	}
}
