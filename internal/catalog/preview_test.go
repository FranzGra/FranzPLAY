package catalog

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/webui"
)

func TestLinkPreview(t *testing.T) {
	s := newPublicSite(t)
	if _, err := s.db.Exec(`INSERT INTO users (name, password_hash, role, can_share_public, created_at)
		VALUES ('Giulia', 'x', 'user', 1, 1)`); err != nil {
		t.Fatal(err)
	}
	const key = "abcdefghijklmnopqrstuv"
	id := s.addVideo(t, "mio.mp4", "0123456789", "Mare", 1, true)
	if _, err := s.db.Exec(`UPDATE videos SET uploaded_by = 1, private = 1, duration = 245,
		cover = '1-abc.jpg', description = '  Una giornata
		al mare  ' WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	preview := LinkPreview(s.db, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ask := func(path string) (webui.Preview, bool) {
		return preview(httptest.NewRequest(http.MethodGet, path, nil))
	}

	if _, ok := ask("/p/" + key); ok {
		t.Error("a preview before the link exists")
	}
	if _, err := s.db.Exec(`INSERT INTO public_links (video_id, token, created_by, created_at) VALUES (?, ?, 1, 1)`,
		id, key); err != nil {
		t.Fatal(err)
	}
	got, ok := ask("/p/" + key)
	want := webui.Preview{Title: "mio.mp4", Description: "Una giornata al mare",
		Image: "/api/public/" + key + "/cover", SiteName: "FranzPLAY"}
	if !ok || got != want {
		t.Errorf("preview = %+v, %v; want %+v", got, ok, want)
	}

	// Without a description: whose video and how long.
	if _, err := s.db.Exec(`UPDATE videos SET description = NULL WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	if got, _ := ask("/p/" + key); got.Description != "Un video di Giulia · 4:05" {
		t.Errorf("description = %q", got.Description)
	}
	// A video from a folder is the site's own.
	if _, err := s.db.Exec(`UPDATE videos SET uploaded_by = NULL, private = 0 WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	if got, _ := ask("/p/" + key); got.Description != "Un video di FranzPLAY · 4:05" {
		t.Errorf("description of a folder video = %q", got.Description)
	}

	// Wrong keys, other pages and a revoked link tell nothing.
	for _, path := range []string{"/p/zzzzzzzzzzzzzzzzzzzzzz", "/p/short", "/video/1", "/p/" + key + "/x"} {
		if got, ok := ask(path); ok {
			t.Errorf("%s: preview %+v", path, got)
		}
	}
	if _, err := s.db.Exec(`DELETE FROM public_links`); err != nil {
		t.Fatal(err)
	}
	if got, ok := ask("/p/" + key); ok {
		t.Errorf("revoked link: preview %+v", got)
	}
}

func TestShorten(t *testing.T) {
	long := strings.Repeat("parola ", 50)
	got := shorten(long, 40)
	if len([]rune(got)) > 40 || !strings.HasSuffix(got, "parola…") {
		t.Errorf("shorten = %q", got)
	}
	if got := shorten("breve", 40); got != "breve" {
		t.Errorf("shorten = %q", got)
	}
}

func TestClock(t *testing.T) {
	for seconds, want := range map[int64]string{5: "0:05", 245: "4:05", 3723: "1:02:03"} {
		if got := clock(seconds); got != want {
			t.Errorf("clock(%d) = %q, want %q", seconds, got, want)
		}
	}
}
