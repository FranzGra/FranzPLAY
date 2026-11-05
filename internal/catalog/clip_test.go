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

func TestAdministratorChoosesTheClipMoment(t *testing.T) {
	s := newAdminSite(t)
	id := s.addVideo(t, "a.mp4", "a", "", 1, true) // 90 seconds long
	address := "/api/admin/videos/" + strconv.FormatInt(id, 10) + "/clip"
	moment := func() (second, seconds *int64) {
		t.Helper()
		v := decode[adminList](t, s.do(t, "GET", "/api/admin/videos", "", http.StatusOK)).Videos[0]
		return v.ClipSecond, v.ClipSeconds
	}
	if second, seconds := moment(); second != nil || seconds != nil {
		t.Fatalf("a new video has a moment: %v %v", second, seconds)
	}

	// A video of their own gives way to the moment chosen.
	s.putClip(t, id, mp4Video, http.StatusNoContent)
	s.do(t, "PUT", address+"/moment", `{"second": 42, "seconds": 10}`, http.StatusNoContent)
	if own, none := s.clipChoice(t, id); own != nil || none {
		t.Errorf("after the moment: own %v, none %v", own, none)
	}
	if files := s.ownClips(t); len(files) != 0 {
		t.Errorf("own clips = %q, want none", files)
	}
	if second, seconds := moment(); second == nil || *second != 42 || seconds == nil || *seconds != 10 {
		t.Errorf("moment = %v %v, want 42 for 10 seconds", second, seconds)
	}
	if got := pendingJobs(t, s.db, id); !slices.Equal(got, []string{"clip"}) {
		t.Errorf("pending jobs = %q, want the clip", got)
	}

	// Made again later, the clip keeps the moment.
	s.do(t, "POST", address+"/remake", "", http.StatusNoContent)
	if second, _ := moment(); second == nil || *second != 42 {
		t.Errorf("after remaking the moment is %v, want 42", second)
	}

	// Back to the site's choice.
	s.do(t, "PUT", address+"/moment", `{"second": null, "seconds": null}`, http.StatusNoContent)
	if second, seconds := moment(); second != nil || seconds != nil {
		t.Errorf("after going back: %v %v", second, seconds)
	}
}

func TestClipMomentRefusals(t *testing.T) {
	s := newAdminSite(t)
	id := s.addVideo(t, "a.mp4", "a", "", 1, true) // 90 seconds long
	notRead := s.addVideo(t, "b.mp4", "b", "", 2, false)
	address := func(id int64) string { return "/api/admin/videos/" + strconv.FormatInt(id, 10) + "/clip/moment" }

	s.do(t, "PUT", address(id), `{"second": 90}`, http.StatusBadRequest)
	s.do(t, "PUT", address(id), `{"second": -1}`, http.StatusBadRequest)
	s.do(t, "PUT", address(id), `{"second": 5, "seconds": 1}`, http.StatusBadRequest)
	s.do(t, "PUT", address(id), `{"second": 5, "seconds": 31}`, http.StatusBadRequest)
	s.do(t, "PUT", address(id), `{"second": 5, "x": 1}`, http.StatusBadRequest)
	s.do(t, "PUT", address(notRead), `{"second": 5}`, http.StatusConflict)
	s.do(t, "PUT", address(999), `{"second": 5}`, http.StatusNotFound)
	s.who.Role = "user"
	s.do(t, "PUT", address(id), `{"second": 5}`, http.StatusForbidden)
	s.do(t, "PUT", "/api/admin/clip-settings", `{"startPercent": 10, "seconds": 6}`, http.StatusForbidden)
	if s.queued != 0 {
		t.Errorf("worker told %d times after refusals", s.queued)
	}
}

func TestClipSettings(t *testing.T) {
	s := newAdminSite(t)
	type settings struct {
		StartPercent int `json:"startPercent"`
		Seconds      int `json:"seconds"`
	}
	// As FranzPLAY always made them.
	if got := decode[settings](t, s.do(t, "GET", "/api/admin/clip-settings", "", http.StatusOK)); got != (settings{0, 6}) {
		t.Errorf("settings = %+v, want automatic for 6 seconds", got)
	}
	s.do(t, "PUT", "/api/admin/clip-settings", `{"startPercent": 20, "seconds": 8}`, http.StatusOK)
	if got := decode[settings](t, s.do(t, "GET", "/api/admin/clip-settings", "", http.StatusOK)); got != (settings{20, 8}) {
		t.Errorf("settings = %+v, want 20%% for 8 seconds", got)
	}
	for _, bad := range []string{`{"startPercent": 96, "seconds": 6}`, `{"startPercent": -1, "seconds": 6}`,
		`{"startPercent": 0, "seconds": 1}`, `{"startPercent": 0, "seconds": 31}`, `{"seconds": 6}`, `{}`} {
		s.do(t, "PUT", "/api/admin/clip-settings", bad, http.StatusBadRequest)
	}
	// Back to the start: nothing left in the settings.
	s.do(t, "PUT", "/api/admin/clip-settings", `{"startPercent": 0, "seconds": 6}`, http.StatusOK)
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM settings WHERE key LIKE 'clips.%'`).Scan(&n); err != nil || n != 0 {
		t.Errorf("clip settings rows = %d (%v), want none", n, err)
	}
	if s.queued != 0 {
		t.Errorf("worker told %d times: the clips already made stay", s.queued)
	}
}
