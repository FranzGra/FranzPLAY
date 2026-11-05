package comments

import (
	"encoding/json"
	"net/http"
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

// Comments are plain text: markup, emoji, accents and very long ones
// come back exactly as kept, never interpreted.
func TestCommentsKeepTheirText(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "mare.mp4")
	tests := []struct{ sent, kept string }{
		{`<script>alert("ciao")</script>`, `<script>alert("ciao")</script>`},
		{`<img src=x onerror="alert(1)"> & &amp; "virgolette" 'apici'`, `<img src=x onerror="alert(1)"> & &amp; "virgolette" 'apici'`},
		{"Città è già più 🎉👨‍👩‍👧‍👦🇮🇹", "Città è già più 🎉👨‍👩‍👧‍👦🇮🇹"},
		{"riga uno\r\nriga due\r\n\r\n\r\n\r\nriga tre", "riga uno\nriga due\n\nriga tre"},
		{`C:\Video\Vacanze\mare.mp4`, `C:\Video\Vacanze\mare.mp4`},
		{"日本語のコメント", "日本語のコメント"},
		{"zero\x00bell\x07 fine", "zerobell fine"},
		{strings.Repeat("😀", maxLen), strings.Repeat("😀", maxLen)},
		{strings.Repeat("à", maxLen), strings.Repeat("à", maxLen)},
	}
	for _, tt := range tests {
		got := s.write(t, giulia, video, tt.sent, 0)
		if got.Body != tt.kept {
			t.Errorf("written %q, kept %q, want %q", short(tt.sent), short(got.Body), short(tt.kept))
		}
	}
	list := decode[[]Comment](t, s.do(t, marco, http.MethodGet, commentsOf(video), ""))
	if len(list) != len(tests) {
		t.Fatalf("read %d comments, want %d", len(list), len(tests))
	}
	for i, tt := range tests {
		// Newest first.
		if got := list[len(list)-1-i].Body; got != tt.kept {
			t.Errorf("read back %q, want %q", short(got), short(tt.kept))
		}
	}

	for _, body := range []string{strings.Repeat("😀", maxLen+1), "\x00\x01\x02", "\n\n\t \r\n"} {
		payload, err := json.Marshal(addRequest{Body: body})
		if err != nil {
			t.Fatal(err)
		}
		if rec := s.do(t, giulia, http.MethodPost, commentsOf(video), string(payload)); rec.Code != http.StatusBadRequest {
			t.Errorf("body %q: %d, want 400", short(body), rec.Code)
		}
	}
}

func short(s string) string {
	if len(s) > 40 {
		return s[:40] + "…"
	}
	return s
}

// Deleting is precise: a reply goes alone, a conversation takes its
// replies, nobody deletes what another person wrote.
func TestDeletingTakesOnlyWhatItShould(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "mare.mp4")
	first := s.write(t, giulia, video, "primo", 0)
	hisReply := s.write(t, marco, video, "risposta di Marco", first.ID)
	herReply := s.write(t, giulia, video, "risposta di Giulia", first.ID)
	second := s.write(t, marco, video, "secondo", 0)
	del := func(user, id int64) int {
		return s.do(t, user, http.MethodDelete, "/api/comments/"+strconv.FormatInt(id, 10), "").Code
	}

	// Giulia started the conversation, but Marco's reply is his.
	if code := del(giulia, hisReply.ID); code != http.StatusForbidden {
		t.Errorf("Giulia deletes Marco's reply: %d, want 403", code)
	}
	if code := del(marco, hisReply.ID); code != http.StatusNoContent {
		t.Fatalf("Marco deletes his reply: %d", code)
	}
	got := decode[[]Comment](t, s.do(t, giulia, http.MethodGet, commentsOf(video), ""))
	if len(got) != 2 || got[1].ID != first.ID || len(got[1].Replies) != 1 || got[1].Replies[0].ID != herReply.ID {
		t.Fatalf("after deleting a reply: %+v", got)
	}
	if code := del(marco, hisReply.ID); code != http.StatusNotFound {
		t.Errorf("deleting twice: %d, want 404", code)
	}
	for _, id := range []string{"0", "-1", "abc", "99999999999999999999"} {
		if rec := s.do(t, giulia, http.MethodDelete, "/api/comments/"+id, ""); rec.Code != http.StatusNotFound {
			t.Errorf("delete %q: %d, want 404", id, rec.Code)
		}
	}

	// A person deleted takes their comments along, and nobody else's.
	s.exec(t, `DELETE FROM users WHERE id = ?`, marco)
	got = decode[[]Comment](t, s.do(t, giulia, http.MethodGet, commentsOf(video), ""))
	if len(got) != 1 || got[0].ID != first.ID || len(got[0].Replies) != 1 {
		t.Errorf("after Marco left: %+v, want Giulia's conversation only", got)
	}
	if code := del(giulia, second.ID); code != http.StatusNotFound {
		t.Errorf("Marco's comment after he left: %d, want 404", code)
	}
}

// The comments of a missing video wait for it; a deleted video takes
// them along.
func TestCommentsFollowTheVideo(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "mare.mp4")
	s.write(t, giulia, video, "ciao", 0)

	s.exec(t, `UPDATE videos SET missing_since = 1 WHERE id = ?`, video)
	if rec := s.do(t, giulia, http.MethodGet, commentsOf(video), ""); rec.Code != http.StatusNotFound {
		t.Errorf("comments of a missing video: %d, want 404", rec.Code)
	}
	s.exec(t, `UPDATE videos SET missing_since = NULL WHERE id = ?`, video)
	if got := decode[[]Comment](t, s.do(t, giulia, http.MethodGet, commentsOf(video), "")); len(got) != 1 {
		t.Errorf("back from the disk: %+v, want the comment again", got)
	}

	s.exec(t, `DELETE FROM videos WHERE id = ?`, video)
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM comments`).Scan(&n); err != nil || n != 0 {
		t.Errorf("comments left = %d (%v), want 0", n, err)
	}
}

// Several people write at the same moment: every comment is kept once,
// and the list keeps a fixed order.
func TestWritingAtOnce(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "mare.mp4")
	const each = 15
	codes := make(chan int, 3*each)
	var wg sync.WaitGroup
	for _, user := range []int64{anna, giulia, marco} {
		wg.Go(func() {
			for i := range each {
				body := `{"body":"commento ` + strconv.Itoa(i) + `"}`
				codes <- s.do(t, user, http.MethodPost, commentsOf(video), body).Code
			}
		})
	}
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != http.StatusCreated {
			t.Fatalf("a comment answered %d, want 201", code)
		}
	}
	first := decode[[]Comment](t, s.do(t, giulia, http.MethodGet, commentsOf(video), ""))
	if len(first) != 3*each {
		t.Fatalf("comments = %d, want %d", len(first), 3*each)
	}
	again := decode[[]Comment](t, s.do(t, giulia, http.MethodGet, commentsOf(video), ""))
	for i := range first {
		if first[i].ID != again[i].ID {
			t.Fatalf("the order changed at %d: %d, then %d", i, first[i].ID, again[i].ID)
		}
	}
}

// Past maxPerVideo comments, the list keeps the newest 1000 and leaves
// out the oldest: a comment just written appears, and the newest
// conversations, which the page shows on top.
func TestNewestCommentsPastTheLimit(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "virale.mp4")
	s.exec(t, `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
		INSERT INTO comments (video_id, user_id, body, created_at) SELECT ?, 3, 'vecchio ' || i, i FROM n`,
		maxPerVideo, video)
	latest := s.write(t, giulia, video, "il più nuovo", 0)
	got := decode[[]Comment](t, s.do(t, giulia, http.MethodGet, commentsOf(video), ""))
	if len(got) == 0 || got[0].ID != latest.ID {
		t.Errorf("newest on top = %+v, want the comment just written", got[:min(len(got), 1)])
	}
}
