package comments

import (
	"net/http"
	"testing"
)

func TestRecentComments(t *testing.T) {
	s := newSite(t)
	mare := s.addVideo(t, "mare.mp4")
	hidden := s.addVideo(t, "segreto.mp4")
	first := s.write(t, giulia, mare, "Che bello!", 0)
	s.write(t, marco, mare, "Vero!", first.ID)
	s.write(t, marco, hidden, "Questo no", 0)
	if _, err := s.db.Exec(`UPDATE videos SET hidden_at = 1 WHERE id = ?`, hidden); err != nil {
		t.Fatal(err)
	}

	rec := s.do(t, anna, http.MethodGet, "/api/comments", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	got := decode[recentList](t, rec)
	if got.Total != 3 || len(got.Comments) != 3 {
		t.Fatalf("recent = %+v", got)
	}
	newest, reply, oldest := got.Comments[0], got.Comments[1], got.Comments[2]
	if newest.Body != "Questo no" || newest.Video.ID != hidden || newest.Video.Visible || newest.Video.Title != "segreto.mp4" {
		t.Errorf("comment under a hidden video = %+v", newest)
	}
	if !reply.Reply || reply.Author.Name != "Marco" || !reply.Video.Visible {
		t.Errorf("reply = %+v", reply)
	}
	if oldest.ID != first.ID || oldest.Reply || oldest.Replies != 1 {
		t.Errorf("first comment = %+v, want 1 reply", oldest)
	}

	page := decode[recentList](t, s.do(t, anna, http.MethodGet, "/api/comments?limit=1&offset=1", ""))
	if page.Total != 3 || len(page.Comments) != 1 || page.Comments[0].ID != reply.ID {
		t.Errorf("page = %+v", page)
	}
	for _, q := range []string{"limit=0", "limit=500", "offset=-1", "limit=x"} {
		if rec := s.do(t, anna, http.MethodGet, "/api/comments?"+q, ""); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", q, rec.Code)
		}
	}
}

func TestRecentCommentsAreForAdministrators(t *testing.T) {
	s := newSite(t)
	if rec := s.do(t, giulia, http.MethodGet, "/api/comments", ""); rec.Code != http.StatusForbidden {
		t.Errorf("as a user: %d, want 403", rec.Code)
	}
	if rec := s.do(t, 0, http.MethodGet, "/api/comments", ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("logged out: %d, want 401", rec.Code)
	}
}
