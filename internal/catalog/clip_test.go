package catalog

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/content"
)

// The start of an MP4 and of a WebM, as http.DetectContentType knows them.
var (
	mp4Video  = append([]byte("\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom"), make([]byte, 600)...)
	webmVideo = append([]byte("\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01\x42\xf7\x81\x01\x42\xf2\x81\x04\x42\xf3\x81\x08\x42\x82\x84webm"), make([]byte, 600)...)
)

// putClip sends a video as the clip of a video.
func (s *adminSite) putClip(t *testing.T, id int64, data []byte, want int) {
	t.Helper()
	rec := httptest.NewRecorder()
	target := "/api/admin/videos/" + strconv.FormatInt(id, 10) + "/clip"
	s.admin.ServeHTTP(rec, httptest.NewRequest("PUT", target, bytes.NewReader(data)))
	if rec.Code != want {
		t.Fatalf("PUT %s = %d, want %d; body %s", target, rec.Code, want, rec.Body)
	}
}

func (s *adminSite) clipChoice(t *testing.T, id int64) (own *string, none bool) {
	t.Helper()
	if err := s.db.QueryRow(`SELECT own_clip, no_clip FROM videos WHERE id = ?`, id).Scan(&own, &none); err != nil {
		t.Fatal(err)
	}
	return own, none
}

func (s *adminSite) ownClips(t *testing.T) []string {
	t.Helper()
	return s.chosenFiles(t, content.FileOwnClip)
}

// chosenFiles lists the files the administrator chose in the folders of the
// videos, the way the database saves them with no version.
func (s *adminSite) chosenFiles(t *testing.T, prefix string) []string {
	t.Helper()
	root := content.Root(s.dataDir)
	folders, err := os.ReadDir(root.VideoFolders())
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	var names []string
	for _, folder := range folders {
		entries, err := os.ReadDir(filepath.Join(root.VideoFolders(), folder.Name()))
		if err != nil {
			t.Fatal(err)
		}
		_, code, _ := strings.Cut(strings.TrimSuffix(folder.Name(), "]"), " [")
		for _, e := range entries {
			if strings.HasPrefix(e.Name(), prefix) {
				names = append(names, content.Stored(code, e.Name(), ""))
			}
		}
	}
	return names
}

// withoutVersion is a value of the database without its version.
func withoutVersion(value string) string {
	return content.Stored(content.CodeOf(value), content.FileOf(value), "")
}

func TestAdministratorChoosesTheClip(t *testing.T) {
	s := newAdminSite(t)
	id := s.addVideo(t, "Viaggi/mare.mp4", "sea", "Viaggi", 100, true)
	libraryBefore := listFiles(t, s.library)
	address := "/api/admin/videos/" + strconv.FormatInt(id, 10) + "/clip"
	clipOf := func() string {
		return decode[adminList](t, s.do(t, "GET", "/api/admin/videos", "", http.StatusOK)).Videos[0].ClipChoice
	}

	// A video of their own, kept in the data folder.
	s.putClip(t, id, mp4Video, http.StatusNoContent)
	own, none := s.clipChoice(t, id)
	if own == nil || none || filepath.Ext(withoutVersion(*own)) != ".mp4" {
		t.Fatalf("after the upload: own %v, none %v", own, none)
	}
	if files := s.ownClips(t); !slices.Equal(files, []string{withoutVersion(*own)}) {
		t.Errorf("own clips = %q, saved %q", files, *own)
	}
	if got := pendingJobs(t, s.db, id); !slices.Equal(got, []string{"clip"}) {
		t.Errorf("pending jobs = %q, want the clip", got)
	}
	if c := clipOf(); c != "video" {
		t.Errorf("clipChoice = %q, want video", c)
	}

	// Another one replaces it.
	s.putClip(t, id, webmVideo, http.StatusNoContent)
	own, _ = s.clipChoice(t, id)
	if files := s.ownClips(t); !slices.Equal(files, []string{withoutVersion(*own)}) || filepath.Ext(withoutVersion(*own)) != ".webm" {
		t.Errorf("own clips = %q, saved %q", files, *own)
	}

	// No clip at all: the uploaded video goes too.
	s.do(t, "DELETE", address, "", http.StatusNoContent)
	if own, none = s.clipChoice(t, id); own != nil || !none {
		t.Errorf("after removing: own %v, none %v", own, none)
	}
	if files := s.ownClips(t); len(files) != 0 {
		t.Errorf("own clips = %q, want none", files)
	}
	if c := clipOf(); c != "none" {
		t.Errorf("clipChoice = %q, want none", c)
	}

	// Made again by FranzPLAY.
	s.do(t, "POST", address+"/remake", "", http.StatusNoContent)
	if own, none = s.clipChoice(t, id); own != nil || none {
		t.Errorf("after remaking: own %v, none %v", own, none)
	}
	if c := clipOf(); c != "" {
		t.Errorf("clipChoice = %q, want FranzPLAY's", c)
	}
	if s.queued != 4 {
		t.Errorf("worker told %d times, want 4", s.queued)
	}
	if after := listFiles(t, s.library); !slices.Equal(after, libraryBefore) {
		t.Errorf("video folder changed: %q, before %q", after, libraryBefore)
	}
}

func TestClipRefusals(t *testing.T) {
	s := newAdminSite(t)
	id := s.addVideo(t, "a.mp4", "a", "", 1, true)
	missing := s.addVideo(t, "c.mp4", "c", "", 3, true)
	if _, err := s.db.Exec(`UPDATE videos SET missing_since = 5 WHERE id = ?`, missing); err != nil {
		t.Fatal(err)
	}
	s.putClip(t, id, pngImage, http.StatusUnsupportedMediaType)
	s.putClip(t, id, nil, http.StatusBadRequest)
	s.putClip(t, id, append(slices.Clone(mp4Video), make([]byte, maxOwnClip)...), http.StatusRequestEntityTooLarge)
	s.putClip(t, 999, mp4Video, http.StatusNotFound)
	s.putClip(t, missing, mp4Video, http.StatusConflict)
	if files := s.ownClips(t); len(files) != 0 {
		t.Errorf("refused videos were kept: %q", files)
	}
	s.do(t, "POST", "/api/admin/videos/999/clip/remake", "", http.StatusNotFound)

	s.who.Role = "user"
	s.putClip(t, id, mp4Video, http.StatusForbidden)
	s.do(t, "DELETE", "/api/admin/videos/"+strconv.FormatInt(id, 10)+"/clip", "", http.StatusForbidden)
	if s.queued != 0 {
		t.Errorf("worker told %d times after refusals", s.queued)
	}
}
