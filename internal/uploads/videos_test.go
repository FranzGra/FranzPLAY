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

func TestSharedVideo(t *testing.T) {
	s := newSite(t)
	if _, err := s.db.Exec(`INSERT INTO users (id, name, password_hash, role, created_at)
		VALUES (3, 'anna', 'x', 'user', 1)`); err != nil {
		t.Fatal(err)
	}
	shares := func(id int64) (people []int64) {
		t.Helper()
		rows, err := s.db.Query(`SELECT user_id FROM video_shares WHERE video_id = ? ORDER BY user_id`, id)
		if err != nil {
			t.Fatal(err)
		}
		defer func() {
			if err := rows.Close(); err != nil {
				t.Error(err)
			}
		}()
		for rows.Next() {
			var p int64
			if err := rows.Scan(&p); err != nil {
				t.Fatal(err)
			}
			people = append(people, p)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return people
	}
	names := func(v myVideo) (out []string) {
		for _, p := range v.SharedWith {
			out = append(out, p.Name)
		}
		return out
	}

	// Refused at the start: the upload is not even made.
	for name, body := range map[string]string{
		"for everybody":   `{"name":"mare.mp4","size":3,"sharedWith":[2]}`,
		"with myself":     `{"name":"mare.mp4","size":3,"private":true,"sharedWith":[1]}`,
		"someone unknown": `{"name":"mare.mp4","size":3,"private":true,"sharedWith":[2,9]}`,
	} {
		if rec := s.do(t, giulia, "POST", "/api/uploads", strings.NewReader(body)); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", name, rec.Code)
		}
	}
	var waiting int
	if err := s.db.QueryRow(`SELECT count(*) FROM uploads`).Scan(&waiting); err != nil || waiting != 0 {
		t.Fatalf("refused uploads left %d rows (%v)", waiting, err)
	}

	// Chosen at the start, the people come with the video.
	body := strings.NewReader(`{"name":"mare.mp4","size":3,"private":true,"sharedWith":[2]}`)
	u := decode[upload](t, s.do(t, giulia, "POST", "/api/uploads", body))
	id := decode[upload](t, s.piece(t, giulia, u.ID, 0, "sea")).Video
	if got := shares(id); len(got) != 1 || got[0] != 2 {
		t.Fatalf("shared with %v, want Marco", got)
	}
	if list := decode[[]myVideo](t, s.do(t, giulia, "GET", "/api/uploads/videos", nil)); len(list) != 1 ||
		strings.Join(names(list[0]), ",") != "Marco" {
		t.Errorf("my videos = %+v", list)
	}

	// Other people instead, by name.
	rec := s.do(t, giulia, "PUT", videoPath(id), strings.NewReader(`{"sharedWith":[3,2]}`))
	expect(t, rec, http.StatusOK)
	if v := decode[myVideo](t, rec); strings.Join(names(v), ",") != "anna,Marco" {
		t.Errorf("shared with %v, want anna and Marco", names(v))
	}
	for name, body := range map[string]string{
		"with myself":     `{"sharedWith":[1]}`,
		"someone unknown": `{"sharedWith":[3,9]}`,
		"and for all":     `{"private":false,"sharedWith":[3]}`,
	} {
		if rec := s.do(t, giulia, "PUT", videoPath(id), strings.NewReader(body)); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", name, rec.Code)
		}
	}
	if got := shares(id); len(got) != 2 {
		t.Errorf("after refused changes shared with %v", got)
	}
	expect(t, s.do(t, marco, "PUT", videoPath(id), strings.NewReader(`{"sharedWith":[]}`)), http.StatusNotFound)

	// For everybody: nobody is chosen any more, and nobody can be.
	expect(t, s.do(t, giulia, "PUT", videoPath(id), strings.NewReader(`{"private":false}`)), http.StatusOK)
	if got := shares(id); len(got) != 0 {
		t.Errorf("public video shared with %v", got)
	}
	expect(t, s.do(t, giulia, "PUT", videoPath(id), strings.NewReader(`{"sharedWith":[2]}`)), http.StatusBadRequest)

	// Only me again, then with Anna.
	expect(t, s.do(t, giulia, "PUT", videoPath(id), strings.NewReader(`{"private":true,"sharedWith":[3]}`)),
		http.StatusOK)
	if got := shares(id); len(got) != 1 || got[0] != 3 {
		t.Errorf("shared with %v, want Anna", got)
	}
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
	res, err := s.db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, folder_category, added_at, uploaded_by)
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
