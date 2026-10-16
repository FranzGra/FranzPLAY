package catalog

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/server"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// newPublicSite is newSite with the addresses of the public links too.
func newPublicSite(t *testing.T) *site {
	t.Helper()
	s := newSite(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	ui := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "ui") })
	s.handler = server.New("test", logger, ui, Routes(s.db, s.dataDir, logger), PublicRoutes(s.db, s.dataDir, logger))
	return s
}

func TestPublicLinkOpensOnlyItsVideo(t *testing.T) {
	s := newPublicSite(t)
	if _, err := s.db.Exec(`INSERT INTO users (name, password_hash, role, can_share_public, created_at)
		VALUES ('Giulia', 'x', 'user', 1, 1)`); err != nil {
		t.Fatal(err)
	}
	const giulia = 1
	const key = "abcdefghijklmnopqrstuv"
	id := s.addVideo(t, "mio.mp4", "0123456789", "Mare", 1, true)
	other := s.addVideo(t, "altro.mp4", "other", "Mare", 2, true)
	if _, err := s.db.Exec(`UPDATE videos SET uploaded_by = ?, private = 1, description = 'al mare' WHERE id = ?`,
		giulia, id); err != nil {
		t.Fatal(err)
	}
	// Nothing is public until its owner makes the link.
	if rec := s.get(t, "/api/public/"+key); rec.Code != http.StatusNotFound {
		t.Fatalf("before the link: status %d, want 404", rec.Code)
	}
	if _, err := s.db.Exec(`INSERT INTO public_links (video_id, token, created_by, created_at) VALUES (?, ?, ?, 1)`,
		id, key, giulia); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(s.dataDir, media.CoversDir), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.dataDir, media.CoversDir, "1-abc.jpg"), []byte("jpeg"), 0o600); err != nil {
		t.Fatal(err)
	}

	base := "/api/public/" + key
	rec := s.get(t, base)
	if rec.Code != http.StatusOK {
		t.Fatalf("public video: status %d: %s", rec.Code, rec.Body)
	}
	body := rec.Body.String()
	var got PublicVideo
	if err := json.Unmarshal([]byte(body), &got); err != nil {
		t.Fatal(err)
	}
	if got.Title != "mio.mp4" || got.Stream != base+"/stream" || got.Cover == nil || *got.Cover != base+"/cover" ||
		got.Description == nil || *got.Description != "al mare" || got.Owner != "Giulia" {
		t.Errorf("public video = %+v", got)
	}
	if strings.Contains(body, `"id"`) || strings.Contains(body, "/api/videos/") || strings.Contains(body, "/api/covers/") {
		t.Errorf("the guest learns ids or addresses behind the login: %s", body)
	}

	// The file, with jumps.
	req := httptest.NewRequest(http.MethodGet, base+"/stream", nil)
	req.Header.Set("Range", "bytes=2-5")
	rec = httptest.NewRecorder()
	s.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusPartialContent || rec.Body.String() != "2345" {
		t.Errorf("stream with Range: status %d, body %q", rec.Code, rec.Body)
	}
	if rec := s.get(t, base+"/cover"); rec.Code != http.StatusOK || rec.Body.String() != "jpeg" ||
		rec.Header().Get("Cache-Control") != "private, no-cache" {
		t.Errorf("cover: status %d, body %q, cache %q", rec.Code, rec.Body, rec.Header().Get("Cache-Control"))
	}
	if rec := s.get(t, base+"/subtitles"); rec.Code != http.StatusOK {
		t.Errorf("subtitles: status %d", rec.Code)
	}
	if rec := s.get(t, base+"/preview"); rec.Code != http.StatusNotFound {
		t.Errorf("no preview: status %d, want 404", rec.Code)
	}

	// The key opens nothing else: another id, a wrong or a short key.
	for _, target := range []string{
		"/api/public/" + key + "/stream?id=" + strconv.FormatInt(other, 10),
		"/api/public/abcdefghijklmnopqrstuw",
		"/api/public/abcdefghijklmnopqrstuw/stream",
		"/api/public/short/stream",
		"/api/public/" + key + "/subtitles/..%2F..%2Ffranzplay.db",
	} {
		rec := s.get(t, target)
		if target == "/api/public/"+key+"/stream?id="+strconv.FormatInt(other, 10) {
			if rec.Body.String() != "0123456789" {
				t.Errorf("%s: the key played another video: %q", target, rec.Body)
			}
			continue
		}
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", target, rec.Code)
		}
	}

	// Hidden, or its creator no longer allowed: the link stops working.
	if _, err := s.db.Exec(`UPDATE users SET can_share_public = 0 WHERE id = ?`, giulia); err != nil {
		t.Fatal(err)
	}
	if rec := s.get(t, base+"/stream"); rec.Code != http.StatusNotFound {
		t.Errorf("creator not allowed: status %d, want 404", rec.Code)
	}
	if _, err := s.db.Exec(`UPDATE users SET can_share_public = 1 WHERE id = ?`, giulia); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE videos SET hidden_at = 1 WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	if rec := s.get(t, base); rec.Code != http.StatusNotFound {
		t.Errorf("hidden video: status %d, want 404", rec.Code)
	}

	// Revoked: gone.
	if _, err := s.db.Exec(`UPDATE videos SET hidden_at = NULL WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`DELETE FROM public_links`); err != nil {
		t.Fatal(err)
	}
	if rec := s.get(t, base+"/stream"); rec.Code != http.StatusNotFound {
		t.Errorf("revoked: status %d, want 404", rec.Code)
	}
}

// TestPublicLinkKeepsTheLoggedInPersonOut checks that through a public
// link even a logged-in person is a guest: no audience, no link of theirs.
func TestPublicLinkKeepsTheLoggedInPersonOut(t *testing.T) {
	s := newPublicSite(t)
	if _, err := s.db.Exec(`INSERT INTO users (name, password_hash, role, created_at) VALUES ('Admin', 'x', 'admin', 1)`); err != nil {
		t.Fatal(err)
	}
	const key = "ZYXWVUTSRQPONMLKJIHGFE"
	id := s.addVideo(t, "cartella.mp4", "folder", "", 1, true)
	if _, err := s.db.Exec(`INSERT INTO public_links (video_id, token, created_by, created_at) VALUES (?, ?, 1, 1)`,
		id, key); err != nil {
		t.Fatal(err)
	}
	rec := s.getAs(t, 1, "/api/public/"+key)
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), "audience") ||
		!strings.Contains(rec.Body.String(), `"videoId":`+strconv.FormatInt(id, 10)) {
		t.Errorf("status %d, body %s", rec.Code, rec.Body)
	}
	// A person who could not open it otherwise does not learn its id.
	private := s.addVideo(t, "privato.mp4", "p", "", 2, true)
	if _, err := s.db.Exec(`UPDATE videos SET private = 1, uploaded_by = 1 WHERE id = ?;
		INSERT INTO users (name, password_hash, role, created_at) VALUES ('Zoe', 'x', 'user', 1);
		UPDATE public_links SET video_id = ?`, private, private); err != nil {
		t.Fatal(err)
	}
	rec = s.getAs(t, 2, "/api/public/"+key)
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), "videoId") {
		t.Errorf("Zoe: status %d, body %s", rec.Code, rec.Body)
	}
}

// TestListsSayWhichVideosArePublic checks the public link in the lists:
// every one for the administrator, on my channel only mine and only with
// the permission, never for the others.
func TestListsSayWhichVideosArePublic(t *testing.T) {
	s := newAdminSite(t)
	if _, err := s.db.Exec(`INSERT INTO users (name, password_hash, role, created_at) VALUES
		('Admin', 'x', 'admin', 1), ('Giulia', 'x', 'user', 1)`); err != nil {
		t.Fatal(err)
	}
	const giulia = 2
	const key = "abcdefghijklmnopqrstuv"
	id := s.addVideo(t, "mio.mp4", "x", "", 1, true)
	plain := s.addVideo(t, "altro.mp4", "y", "", 2, true)
	if _, err := s.db.Exec(`UPDATE videos SET uploaded_by = ? WHERE id IN (?, ?)`, giulia, id, plain); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`INSERT INTO public_links (video_id, token, created_by, created_at) VALUES (?, ?, ?, 1)`,
		id, key, giulia); err != nil {
		t.Fatal(err)
	}
	links := func(body string) map[int64]string {
		t.Helper()
		var got struct {
			Videos []struct {
				ID         int64   `json:"id"`
				PublicLink *string `json:"publicLink"`
			} `json:"videos"`
		}
		if err := json.Unmarshal([]byte(body), &got); err != nil {
			t.Fatal(err)
		}
		out := map[int64]string{}
		for _, v := range got.Videos {
			if v.PublicLink != nil {
				out[v.ID] = *v.PublicLink
			}
		}
		return out
	}

	got := links(s.do(t, "GET", "/api/admin/videos", "", http.StatusOK).Body.String())
	if len(got) != 1 || got[id] != "/p/"+key {
		t.Errorf("administrator's list: %v", got)
	}

	channel := "/api/videos?uploader=" + strconv.Itoa(giulia)
	as := func(a users.Account) map[int64]string {
		req := httptest.NewRequest(http.MethodGet, channel, nil)
		req = req.WithContext(users.NewContext(req.Context(), a))
		rec := httptest.NewRecorder()
		s.handler.ServeHTTP(rec, req)
		return links(rec.Body.String())
	}
	if got := as(users.Account{ID: giulia, Role: users.User, CanSharePublic: true}); len(got) != 1 || got[id] != "/p/"+key {
		t.Errorf("Giulia with the permission: %v", got)
	}
	if got := as(users.Account{ID: giulia, Role: users.User}); len(got) != 0 {
		t.Errorf("Giulia without the permission: %v", got)
	}
	if got := as(users.Account{ID: 1, Role: users.Admin}); len(got) != 0 {
		t.Errorf("someone else's channel: %v", got)
	}
}
