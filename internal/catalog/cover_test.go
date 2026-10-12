package catalog

import (
	"bytes"
	"database/sql"
	"errors"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/media"
)

// A PNG and a JPEG as http.DetectContentType recognizes them.
var (
	pngImage  = append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 64)...)
	jpegImage = append([]byte("\xff\xd8\xff\xe0"), make([]byte, 64)...)
)

func TestOwnCoverExt(t *testing.T) {
	tests := []struct {
		name string
		data []byte
		ext  string
		ok   bool
	}{
		{"png", pngImage, ".png", true},
		{"jpeg", jpegImage, ".jpg", true},
		{"webp", []byte("RIFF\x00\x00\x00\x00WEBPVP8 "), ".webp", true},
		{"text", []byte("ciao"), "", false},
		{"html", []byte("<html><script>"), "", false},
		{"empty", nil, "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ext, ok := ownCoverExt(tt.data)
			if ext != tt.ext || ok != tt.ok {
				t.Errorf("ownCoverExt = %q, %v; want %q, %v", ext, ok, tt.ext, tt.ok)
			}
		})
	}
}

// putImage sends an image as the cover of a video.
func (s *adminSite) putImage(t *testing.T, id int64, data []byte, want int) {
	t.Helper()
	rec := httptest.NewRecorder()
	target := "/api/admin/videos/" + strconv.FormatInt(id, 10) + "/cover"
	s.admin.ServeHTTP(rec, httptest.NewRequest("PUT", target, bytes.NewReader(data)))
	if rec.Code != want {
		t.Fatalf("PUT %s = %d, want %d; body %s", target, rec.Code, want, rec.Body)
	}
}

// coverChoice reads the choice saved for a video.
func (s *adminSite) coverChoice(t *testing.T, id int64) (own *string, second *int64) {
	t.Helper()
	if err := s.db.QueryRow(`SELECT own_cover, cover_second FROM videos WHERE id = ?`, id).Scan(&own, &second); err != nil {
		t.Fatal(err)
	}
	return own, second
}

func (s *adminSite) ownCovers(t *testing.T) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(s.dataDir, media.OwnCoversDir))
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

func TestAdministratorChoosesTheCover(t *testing.T) {
	s := newAdminSite(t)
	id := s.addVideo(t, "Viaggi/mare.mp4", "sea", "Viaggi", 100, true)
	libraryBefore := listFiles(t, s.library)
	address := "/api/admin/videos/" + strconv.FormatInt(id, 10)

	// An image of their own: kept in the data folder, and the cover is made again.
	s.putImage(t, id, pngImage, http.StatusNoContent)
	own, second := s.coverChoice(t, id)
	if own == nil || second != nil {
		t.Fatalf("after the image: own %v, second %v", own, second)
	}
	if files := s.ownCovers(t); len(files) != 1 || files[0] != *own || filepath.Ext(*own) != ".png" {
		t.Fatalf("own covers = %q, saved %q", files, *own)
	}
	if got := pendingJobs(t, s.db, id); len(got) != 1 || got[0] != "cover" {
		t.Errorf("pending jobs = %q, want the cover", got)
	}
	v := decode[adminList](t, s.do(t, "GET", "/api/admin/videos", "", http.StatusOK)).Videos[0]
	if v.CoverChoice != "image" {
		t.Errorf("coverChoice = %q, want image", v.CoverChoice)
	}

	// Another image replaces the first, which goes.
	s.putImage(t, id, jpegImage, http.StatusNoContent)
	own, _ = s.coverChoice(t, id)
	if files := s.ownCovers(t); len(files) != 1 || files[0] != *own || filepath.Ext(*own) != ".jpg" {
		t.Fatalf("own covers = %q, saved %q", files, *own)
	}

	// A moment of the video: the image is no longer needed.
	s.do(t, "PUT", address+"/cover-second", `{"second": 42}`, http.StatusNoContent)
	own, second = s.coverChoice(t, id)
	if own != nil || second == nil || *second != 42 {
		t.Fatalf("after the moment: own %v, second %v", own, second)
	}
	if files := s.ownCovers(t); len(files) != 0 {
		t.Errorf("own covers = %q, want none", files)
	}
	v = decode[adminList](t, s.do(t, "GET", "/api/admin/videos", "", http.StatusOK)).Videos[0]
	if v.CoverChoice != "moment" || v.CoverSecond == nil || *v.CoverSecond != 42 {
		t.Errorf("after the moment: %+v", v)
	}

	// Back to FranzPLAY's own.
	s.do(t, "DELETE", address+"/cover", "", http.StatusNoContent)
	if own, second = s.coverChoice(t, id); own != nil || second != nil {
		t.Errorf("after going back: own %v, second %v", own, second)
	}
	if s.queued != 4 || s.changed != 4 {
		t.Errorf("worker told %d times, pages %d, want 4 each", s.queued, s.changed)
	}
	// Rule 1: the video folder is never touched.
	if after := listFiles(t, s.library); !slices.Equal(after, libraryBefore) {
		t.Errorf("video folder changed: %q, before %q", after, libraryBefore)
	}
}

func TestCoverRefusals(t *testing.T) {
	s := newAdminSite(t)
	id := s.addVideo(t, "a.mp4", "a", "", 1, true) // 90 seconds long
	notRead := s.addVideo(t, "b.mp4", "b", "", 2, false)
	missing := s.addVideo(t, "c.mp4", "c", "", 3, true)
	if _, err := s.db.Exec(`UPDATE videos SET missing_since = 5 WHERE id = ?`, missing); err != nil {
		t.Fatal(err)
	}
	address := func(id int64) string { return "/api/admin/videos/" + strconv.FormatInt(id, 10) }

	s.putImage(t, id, []byte("<html><script>alert(1)</script>"), http.StatusUnsupportedMediaType)
	s.putImage(t, id, append(pngImage, make([]byte, maxOwnCover)...), http.StatusRequestEntityTooLarge)
	s.putImage(t, 999, pngImage, http.StatusNotFound)
	s.putImage(t, missing, pngImage, http.StatusConflict)
	if files := s.ownCovers(t); len(files) != 0 {
		t.Errorf("refused images were kept: %q", files)
	}

	s.do(t, "PUT", address(id)+"/cover-second", `{"second": 91}`, http.StatusBadRequest)
	s.do(t, "PUT", address(id)+"/cover-second", `{"second": -1}`, http.StatusBadRequest)
	s.do(t, "PUT", address(id)+"/cover-second", `{}`, http.StatusBadRequest)
	s.do(t, "PUT", address(id)+"/cover-second", `{"second": 5, "x": 1}`, http.StatusBadRequest)
	s.do(t, "PUT", address(notRead)+"/cover-second", `{"second": 5}`, http.StatusConflict)
	s.do(t, "DELETE", address(999)+"/cover", "", http.StatusNotFound)

	// Only administrators.
	s.who.Role = "user"
	s.putImage(t, id, pngImage, http.StatusForbidden)
	s.do(t, "PUT", address(id)+"/cover-second", `{"second": 5}`, http.StatusForbidden)
	s.do(t, "DELETE", address(id)+"/cover", "", http.StatusForbidden)
	s.who.ID = 0
	s.do(t, "DELETE", address(id)+"/cover", "", http.StatusUnauthorized)
	if s.queued != 0 {
		t.Errorf("worker told %d times after refusals", s.queued)
	}
}

// pendingJobs lists the kinds of the jobs waiting for a video.
func pendingJobs(t *testing.T, db *sql.DB, id int64) []string {
	t.Helper()
	rows, err := db.Query(`SELECT kind FROM jobs WHERE video_id = ? AND state = 'pending' ORDER BY kind`, id)
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
	return kinds
}

// listFiles lists every file under root.
func listFiles(t *testing.T, root string) []string {
	t.Helper()
	var names []string
	err := filepath.WalkDir(root, func(path string, _ fs.DirEntry, err error) error {
		names = append(names, path)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return names
}
