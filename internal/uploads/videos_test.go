package uploads

import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/users"
)

// uploadVideo uploads content in one piece and returns the new video.
func (s *site) uploadVideo(t *testing.T, name, content string) int64 {
	t.Helper()
	u := decode[upload](t, s.start(t, giulia, name, "", len(content)))
	done := decode[upload](t, s.piece(t, giulia, u.ID, 0, content))
	if done.Video == 0 {
		t.Fatalf("upload of %s did not become a video", name)
	}
	return done.Video
}

func videoPath(id int64) string { return "/api/uploads/videos/" + strconv.FormatInt(id, 10) }

func TestMyVideos(t *testing.T) {
	s := newSite(t)
	first := s.uploadVideo(t, "mare.mp4", "sea")
	s.clock = s.clock.Add(1)
	second := s.uploadVideo(t, "lago.mp4", "lake")

	list := decode[[]myVideo](t, s.do(t, giulia, "GET", "/api/uploads/videos", nil))
	if len(list) != 2 || list[0].ID != second || list[1].ID != first || list[1].Title != "mare" ||
		list[1].Size != 3 {
		t.Fatalf("my videos = %+v", list)
	}
	if other := decode[[]myVideo](t, s.do(t, marco, "GET", "/api/uploads/videos", nil)); len(other) != 0 {
		t.Errorf("Marco sees %+v", other)
	}
	expect(t, s.do(t, users.Account{}, "GET", "/api/uploads/videos", nil), http.StatusUnauthorized)
}

func TestRenameMyVideo(t *testing.T) {
	s := newSite(t)
	id := s.uploadVideo(t, "mare.mp4", "sea")

	rec := s.do(t, giulia, "PUT", videoPath(id), strings.NewReader(`{"title":"  Al mare  "}`))
	expect(t, rec, http.StatusOK)
	if v := decode[myVideo](t, rec); v.Title != "Al mare" {
		t.Errorf("renamed = %+v", v)
	}
	for name, tc := range map[string]struct {
		who  users.Account
		body string
		want int
	}{
		"empty":         {giulia, `{"title":" "}`, http.StatusBadRequest},
		"too long":      {giulia, `{"title":"` + strings.Repeat("a", 201) + `"}`, http.StatusBadRequest},
		"unknown field": {giulia, `{"title":"a","hidden":true}`, http.StatusBadRequest},
		"someone else":  {marco, `{"title":"Mio"}`, http.StatusNotFound},
	} {
		if rec := s.do(t, tc.who, "PUT", videoPath(id), strings.NewReader(tc.body)); rec.Code != tc.want {
			t.Errorf("%s: status %d, want %d", name, rec.Code, tc.want)
		}
	}
	var title string
	if err := s.db.QueryRow(`SELECT shown_title FROM videos WHERE id = ?`, id).Scan(&title); err != nil {
		t.Fatal(err)
	}
	if title != "Al mare" {
		t.Errorf("title is %q after refused changes", title)
	}
}

func TestPrivateVideo(t *testing.T) {
	s := newSite(t)
	body := strings.NewReader(`{"name":"mare.mp4","size":3,"private":true}`)
	u := decode[upload](t, s.do(t, giulia, "POST", "/api/uploads", body))
	if !u.Private {
		t.Fatalf("upload = %+v, want private", u)
	}
	id := decode[upload](t, s.piece(t, giulia, u.ID, 0, "sea")).Video
	state := func() (private, visible bool) {
		t.Helper()
		if err := s.db.QueryRow(`SELECT private, visible FROM videos WHERE id = ?`, id).
			Scan(&private, &visible); err != nil {
			t.Fatal(err)
		}
		return private, visible
	}
	if private, visible := state(); !private || visible {
		t.Errorf("new video: private %v, visible %v; want only Giulia to see it", private, visible)
	}
	if list := decode[[]myVideo](t, s.do(t, giulia, "GET", "/api/uploads/videos", nil)); !list[0].Private {
		t.Errorf("my videos = %+v", list)
	}

	// For everybody, keeping the title.
	rec := s.do(t, giulia, "PUT", videoPath(id), strings.NewReader(`{"private":false}`))
	expect(t, rec, http.StatusOK)
	if v := decode[myVideo](t, rec); v.Private || v.Title != "mare" {
		t.Errorf("changed = %+v", v)
	}
	if private, visible := state(); private || !visible {
		t.Errorf("after the change: private %v, visible %v", private, visible)
	}
	expect(t, s.do(t, marco, "PUT", videoPath(id), strings.NewReader(`{"private":true}`)), http.StatusNotFound)
}

func TestDeleteMyVideo(t *testing.T) {
	s := newSite(t)
	id := s.uploadVideo(t, "mare.mp4", "sea")
	folder, err := Folder(s.data)
	if err != nil {
		t.Fatal(err)
	}
	var rel string
	if err := s.db.QueryRow(`SELECT path FROM videos WHERE id = ?`, id).Scan(&rel); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(folder, filepath.FromSlash(rel))

	expect(t, s.do(t, marco, "DELETE", videoPath(id), nil), http.StatusNotFound)
	if _, err := os.Stat(file); err != nil {
		t.Fatalf("Marco's refused delete touched the file: %v", err)
	}

	expect(t, s.do(t, giulia, "DELETE", videoPath(id), nil), http.StatusNoContent)
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Errorf("file still there: %v", err)
	}
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM videos`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("%d videos left", n)
	}
	// The space is free again.
	if sp := decode[mine](t, s.do(t, giulia, "GET", "/api/uploads", nil)).Space; sp.Used != 0 {
		t.Errorf("space after delete = %+v", sp)
	}
	expect(t, s.do(t, giulia, "DELETE", videoPath(id), nil), http.StatusNotFound)
}

// Rule 1: a video of the video folders is never deleted from the disk,
// even if the database wrongly says someone uploaded it.
func TestDeleteNeverTouchesTheVideoFolders(t *testing.T) {
	s := newSite(t)
	library := t.TempDir()
	file := filepath.Join(library, "film.mp4")
	if err := os.WriteFile(file, []byte("film"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`INSERT INTO libraries (id, path) VALUES (50, ?)`, library); err != nil {
		t.Fatal(err)
	}
	res, err := s.db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, category, added_at, uploaded_by)
		VALUES ('fp', 50, 'film.mp4', 4, 1, 'film', '', 1, 1)`)
	if err != nil {
		t.Fatal(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}

	if rec := s.do(t, giulia, "DELETE", videoPath(id), nil); rec.Code != http.StatusInternalServerError {
		t.Errorf("status %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	if _, err := os.Stat(file); err != nil {
		t.Fatalf("the video folder's file is gone: %v", err)
	}
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM videos WHERE id = ?`, id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Error("the refused delete still removed the video from the catalog")
	}
}
