package catalog

import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/content"
)

// A video with its files in its own folder and one with them in the old flat
// folders are served side by side.
func TestFilesOfOldAndNewVideosAreServed(t *testing.T) {
	s := newSite(t)
	root := content.Root(s.dataDir)
	newID := s.addVideo(t, "nuovo.mp4", "new", "", 2, true)
	oldID := s.addVideo(t, "vecchio.mp4", "old", "", 1, true)

	code, _, err := root.EnsureFolder("v1:000000000000000000000000a1b2c3d4", "nuovo.mp4")
	if err != nil {
		t.Fatal(err)
	}
	for file, data := range map[string]string{
		content.FileCover: "new cover", content.FileTimeline: "new timeline", content.FileClip: "new clip",
		content.FileClipHD: "new sharp clip", content.FileConverted: "new copy",
		content.InsideSubtitleFile(2):  "WEBVTT\n\n00:01.000 --> 00:02.000\nnuovo\n",
		content.AutoSubtitleFile("it"): "WEBVTT\n\n00:01.000 --> 00:02.000\nfatto\n",
	} {
		if err := root.PutBytes(code, file, []byte(data)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.db.Exec(`UPDATE videos SET cover = ?, preview = ?, preview_gap = 3, preview_count = 4, preview_width = 480,
		preview_height = 270, clip = ?, clip_hd = ?, converted = ?, fingerprint = 'v1:000000000000000000000000a1b2c3d4' WHERE id = ?`,
		content.Stored(code, content.FileCover, "s30"), content.Stored(code, content.FileTimeline, "w480t"),
		content.Stored(code, content.FileClip, ""), content.Stored(code, content.FileClipHD, ""),
		content.Stored(code, content.FileConverted, ""), newID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`INSERT INTO video_subtitles (video_id, stream, lang, title, forced, file) VALUES (?, 2, 'ita', '', 0, ?)`,
		newID, content.Stored(code, content.InsideSubtitleFile(2), "")); err != nil {
		t.Fatal(err)
	}

	for dir, data := range map[string]string{
		root.Covers(): "old cover", root.Previews(): "old timeline", root.Clips(): "old clip", root.ClipsHD(): "old sharp clip",
	} {
		ext := ".jpg"
		if strings.Contains(dir, "clips") {
			ext = ".mp4"
		}
		if err := os.MkdirAll(dir, 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "2-abc"+ext), []byte(data), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(root.Subtitles(), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root.Subtitles(), "2-abc-2.vtt"), []byte("WEBVTT\n\n00:01.000 --> 00:02.000\nvecchio\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE videos SET cover = '2-abc.jpg', preview = '2-abc.jpg', preview_gap = 3, preview_count = 4,
		preview_width = 480, preview_height = 270, clip = '2-abc.mp4', clip_hd = '2-abc.mp4' WHERE id = ?`, oldID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`INSERT INTO video_subtitles (video_id, stream, lang, title, forced, file) VALUES (?, 2, 'ita', '', 0, '2-abc-2.vtt')`, oldID); err != nil {
		t.Fatal(err)
	}

	got := func(id int64) Video {
		t.Helper()
		return decode[Video](t, s.get(t, "/api/videos/"+strconv.FormatInt(id, 10)))
	}
	serves := func(address, want string) {
		t.Helper()
		rec := s.get(t, address)
		if rec.Code != http.StatusOK || rec.Body.String() != want {
			t.Errorf("%s = %d %q, want %q", address, rec.Code, rec.Body, want)
		}
	}

	nv := got(newID)
	if nv.Cover == nil || *nv.Cover != "/api/covers/"+code+".jpg?v=s30" {
		t.Fatalf("new cover address = %v", nv.Cover)
	}
	serves(*nv.Cover, "new cover")
	if nv.Preview == nil || nv.Preview.Src != "/api/previews/"+code+".jpg?v=w480t" {
		t.Fatalf("new preview = %+v", nv.Preview)
	}
	serves(nv.Preview.Src, "new timeline")
	serves(*nv.Clip, "new clip")
	serves(*nv.ClipHD, "new sharp clip")

	ov := got(oldID)
	if ov.Cover == nil || *ov.Cover != "/api/covers/2-abc.jpg" {
		t.Fatalf("old cover address = %v", ov.Cover)
	}
	serves(*ov.Cover, "old cover")
	serves(ov.Preview.Src, "old timeline")
	serves(*ov.Clip, "old clip")
	serves(*ov.ClipHD, "old sharp clip")

	// The stream gets the copy from the folder of the video.
	serves("/api/videos/"+strconv.FormatInt(newID, 10)+"/stream", "new copy")

	for id, want := range map[int64]string{newID: "nuovo", oldID: "vecchio"} {
		rec := s.get(t, "/api/videos/"+strconv.FormatInt(id, 10)+"/subtitles/"+insidePrefix+"2")
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), want) {
			t.Errorf("subtitle of %d = %d %q, want %q", id, rec.Code, rec.Body, want)
		}
	}

	// A folder renamed does not change a single address.
	if renamed, err := root.FollowName("v1:000000000000000000000000a1b2c3d4", "Un altro nome.mp4"); err != nil || !renamed {
		t.Fatalf("renamed %v, %v", renamed, err)
	}
	serves(*nv.Cover, "new cover")
	serves("/api/videos/"+strconv.FormatInt(newID, 10)+"/stream", "new copy")

	for _, address := range []string{
		"/api/covers/ffffffff.jpg",                // no folder with this code
		"/api/covers/" + code + ".png",            // not a cover
		"/api/covers/" + code,                     // not a cover
		"/api/covers/" + code + "..%2F..%2Fx.jpg", // leaving the folder
		"/api/covers/" + strings.ToUpper(code) + ".jpg",
	} {
		if rec := s.get(t, address); rec.Code != http.StatusNotFound {
			t.Errorf("%s = %d, want 404", address, rec.Code)
		}
	}
}
