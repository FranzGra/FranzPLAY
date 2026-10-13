package media

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// clipFixture is a catalog with one video of the given duration and a
// clipper on a temp data folder.
type clipFixture struct {
	db      *sql.DB
	id      int64
	dataDir string
	c       *Clipper
}

func newClipFixture(t *testing.T, root, rel string, duration int64) *clipFixture {
	t.Helper()
	db, id := catalog(t, root, rel)
	if _, err := db.Exec(`UPDATE videos SET duration = ? WHERE id = ?`, duration, id); err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	return &clipFixture{db: db, id: id, dataDir: dataDir, c: NewClipper(db, "ffmpeg", dataDir)}
}

// saved returns the light clip saved in the database.
func (fx *clipFixture) saved(t *testing.T) sql.NullString {
	t.Helper()
	return fx.savedIn(t, "clip")
}

// savedHD returns the sharp clip saved in the database.
func (fx *clipFixture) savedHD(t *testing.T) sql.NullString {
	t.Helper()
	return fx.savedIn(t, "clip_hd")
}

func (fx *clipFixture) savedIn(t *testing.T, column string) sql.NullString {
	t.Helper()
	var name sql.NullString
	if err := fx.db.QueryRow(`SELECT `+column+` FROM videos WHERE id = ?`, fx.id).Scan(&name); err != nil {
		t.Fatal(err)
	}
	return name
}

// files returns what is in the folder of the light clips.
func (fx *clipFixture) files(t *testing.T) []string {
	t.Helper()
	return fx.filesIn(t, ClipsDir)
}

// filesHD returns what is in the folder of the sharp clips.
func (fx *clipFixture) filesHD(t *testing.T) []string {
	t.Helper()
	return fx.filesIn(t, ClipsHDDir)
}

func (fx *clipFixture) filesIn(t *testing.T, folder string) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(fx.dataDir, folder))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

// fakeClipFFmpeg pretends to be ffmpeg: it writes data in each file it
// is asked for, then fails with err.
func fakeClipFFmpeg(data string, err error) runFunc {
	return func(_ context.Context, _ string, args ...string) ([]byte, error) {
		for _, out := range clipOutputFiles(args) {
			if writeErr := os.WriteFile(out, []byte(data), 0o600); writeErr != nil {
				return nil, writeErr
			}
		}
		return nil, err
	}
}

// clipOutputFiles returns the files an ffmpeg command writes: those after
// "-f mp4".
func clipOutputFiles(args []string) []string {
	var outs []string
	for i := 0; i+2 < len(args); i++ {
		if args[i] == "-f" && args[i+1] == "mp4" {
			outs = append(outs, strings.TrimPrefix(args[i+2], "file:"))
		}
	}
	return outs
}

func TestClipSaved(t *testing.T) {
	fx := newClipFixture(t, "/videos", "a.mp4", 600)
	var calls [][]string
	fx.c.run = func(ctx context.Context, program string, args ...string) ([]byte, error) {
		calls = append(calls, args)
		return fakeClipFFmpeg("clip", nil)(ctx, program, args...)
	}
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if s := fx.saved(t); s.String != "1-fp.mp4" {
		t.Errorf("saved %+v, want 1-fp.mp4", s)
	}
	if files := fx.files(t); !slices.Equal(files, []string{"1-fp.mp4"}) {
		t.Errorf("clips folder = %q, want the clip and no work files", files)
	}
	// The sharp twin, made by the same run of ffmpeg, with the same name.
	if s := fx.savedHD(t); s.String != "1-fp.mp4" {
		t.Errorf("saved sharp %+v, want 1-fp.mp4", s)
	}
	if files := fx.filesHD(t); !slices.Equal(files, []string{"1-fp.mp4"}) {
		t.Errorf("sharp clips folder = %q", files)
	}
	if len(calls) != 4 {
		t.Fatalf("ffmpeg ran %d times, want one per moment and one to join them", len(calls))
	}
	// Three moments, one at a time, each read straight from its place.
	for i, start := range []string{"150", "300", "450"} {
		joined := strings.Join(calls[i], " ")
		for _, want := range []string{"-ss " + start + " -t 2 -i file:/videos/a.mp4", "min(720,ih)", "-an"} {
			if !strings.Contains(joined, want) {
				t.Errorf("moment %d: ffmpeg command %q has no %q", i, joined, want)
			}
		}
		if outs := clipOutputFiles(calls[i]); len(outs) != 1 {
			t.Errorf("moment %d writes %q, want one piece", i, outs)
		}
	}
	// The last run joins the pieces and writes both clips.
	last := calls[3]
	if outs := clipOutputFiles(last); len(outs) != 2 {
		t.Errorf("ffmpeg writes %q, want two clips", outs)
	}
	joined := strings.Join(last, " ")
	for _, want := range []string{"concat=n=3:v=1:a=0", "split=2", "scale=-2:360", "-an", "+faststart"} {
		if !strings.Contains(joined, want) {
			t.Errorf("ffmpeg command %q has no %q", joined, want)
		}
	}
	if strings.Contains(joined, "/videos/a.mp4") {
		t.Errorf("the join reads the video again: %q", joined)
	}
}

func TestClipFollowsTheAdministratorsChoice(t *testing.T) {
	fx := newClipFixture(t, "/videos", "a.mp4", 600)
	var got []string
	fx.c.run = func(ctx context.Context, program string, args ...string) ([]byte, error) {
		got = args
		return fakeClipFFmpeg("clip", nil)(ctx, program, args...)
	}
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}

	// A video of their own: its first seconds, made like the others, with
	// a new name so browsers do not keep the old clip.
	if _, err := fx.db.Exec(`UPDATE videos SET own_clip = '1-0123456789abcdef.webm' WHERE id = ?`, fx.id); err != nil {
		t.Fatal(err)
	}
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	uploaded := "file:" + filepath.Join(fx.dataDir, OwnClipsDir, "1-0123456789abcdef.webm")
	joined := strings.Join(got, " ")
	for _, want := range []string{"-t 15 -i " + uploaded, "min(720,ih)", "scale=-2:360", "-an", "+faststart"} {
		if !strings.Contains(joined, want) {
			t.Errorf("ffmpeg command %q has no %q", joined, want)
		}
	}
	if strings.Contains(joined, "/videos/a.mp4") {
		t.Errorf("the clip still comes from the video: %q", joined)
	}
	if s := fx.saved(t); s.String != "1-fp-o89abcdef.mp4" {
		t.Errorf("saved %+v, want 1-fp-o89abcdef.mp4", s)
	}
	if files := fx.files(t); !slices.Equal(files, []string{"1-fp-o89abcdef.mp4"}) {
		t.Errorf("clips folder = %q, want only the new clip", files)
	}
	if files := fx.filesHD(t); !slices.Equal(files, []string{"1-fp-o89abcdef.mp4"}) {
		t.Errorf("sharp clips folder = %q, want only the new clip", files)
	}

	// No clip at all: the clip goes, and ffmpeg is not even run.
	got = nil
	if _, err := fx.db.Exec(`UPDATE videos SET own_clip = NULL, no_clip = 1 WHERE id = ?`, fx.id); err != nil {
		t.Fatal(err)
	}
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if s, hd := fx.saved(t), fx.savedHD(t); s.Valid || hd.Valid || got != nil {
		t.Errorf("saved %+v and %+v, ffmpeg %q; want no clip and no ffmpeg", s, hd, got)
	}
	if files, hd := fx.files(t), fx.filesHD(t); len(files) != 0 || len(hd) != 0 {
		t.Errorf("clips folders = %q and %q, want empty", files, hd)
	}
}

func TestClipOfAShortVideo(t *testing.T) {
	fx := newClipFixture(t, "/videos", "a.mp4", 3)
	fx.c.run = func(context.Context, string, ...string) ([]byte, error) {
		t.Fatal("ffmpeg must not run for a 3 second video")
		return nil, nil
	}
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if s := fx.saved(t); s.Valid {
		t.Errorf("clip saved: %+v", s)
	}
}

func TestClipFailuresLeaveNothingBehind(t *testing.T) {
	tests := []struct {
		name string
		run  runFunc
	}{
		{"ffmpeg fails", fakeClipFFmpeg("half", errors.New("exit status 1"))},
		{"ffmpeg writes nothing", fakeClipFFmpeg("", nil)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fx := newClipFixture(t, "/videos", "a.mp4", 60)
			fx.c.run = tt.run
			if err := fx.c.Handle(context.Background(), fx.id); err == nil {
				t.Fatal("no error")
			}
			if files, hd := fx.files(t), fx.filesHD(t); len(files) != 0 || len(hd) != 0 {
				t.Errorf("files left in the clips folders: %q and %q", files, hd)
			}
			if fx.saved(t).Valid || fx.savedHD(t).Valid {
				t.Error("clip saved after a failure")
			}
		})
	}
}

func TestClipReplacesTheOldOne(t *testing.T) {
	fx := newClipFixture(t, "/videos", "a.mp4", 60)
	for _, folder := range []string{ClipsDir, ClipsHDDir} {
		dir := filepath.Join(fx.dataDir, folder)
		if err := os.MkdirAll(dir, 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "1-old.mp4"), []byte("old"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := fx.db.Exec(`UPDATE videos SET clip = '1-old.mp4', clip_hd = '1-old.mp4' WHERE id = ?`, fx.id); err != nil {
		t.Fatal(err)
	}
	fx.c.run = fakeClipFFmpeg("new", nil)
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if files := fx.files(t); !slices.Equal(files, []string{"1-fp.mp4"}) {
		t.Errorf("clips folder = %q, want only the new clip", files)
	}
	if files := fx.filesHD(t); !slices.Equal(files, []string{"1-fp.mp4"}) {
		t.Errorf("sharp clips folder = %q, want only the new clip", files)
	}
}

// TestClipMadeAgainKeepsItsName: a clip made again for the same content
// (as after the update that added the sharp clips) replaces the files in
// place and does not remove them as old.
func TestClipMadeAgainKeepsItsName(t *testing.T) {
	fx := newClipFixture(t, "/videos", "a.mp4", 60)
	fx.c.run = fakeClipFFmpeg("first", nil)
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	fx.c.run = fakeClipFFmpeg("second", nil)
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	for _, folder := range []string{ClipsDir, ClipsHDDir} {
		data, err := os.ReadFile(filepath.Join(fx.dataDir, folder, "1-fp.mp4"))
		if err != nil || string(data) != "second" {
			t.Errorf("%s/1-fp.mp4 = %q (%v), want the second clip", folder, data, err)
		}
	}
}

func TestClipOfContentThatChangedMeanwhileIsDropped(t *testing.T) {
	fx := newClipFixture(t, "/videos", "a.mp4", 60)
	fx.c.run = func(ctx context.Context, program string, args ...string) ([]byte, error) {
		if _, err := fx.db.Exec(`UPDATE videos SET fingerprint = 'v1:other' WHERE id = ?`, fx.id); err != nil {
			t.Fatal(err)
		}
		return fakeClipFFmpeg("clip", nil)(ctx, program, args...)
	}
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if fx.saved(t).Valid || fx.savedHD(t).Valid || len(fx.files(t)) != 0 || len(fx.filesHD(t)) != 0 {
		t.Errorf("clip of the old content kept: %+v %q %q", fx.saved(t), fx.files(t), fx.filesHD(t))
	}
}

func TestRemoveOrphanClips(t *testing.T) {
	fx := newClipFixture(t, "/videos", "a.mp4", 60)
	fx.c.run = fakeClipFFmpeg("clip", nil)
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	kept := fx.saved(t).String
	// In both folders, a forgotten clip and one left half made by a crash.
	for _, folder := range []string{ClipsDir, ClipsHDDir} {
		for _, name := range []string{"99-forgotten.mp4", ".new-123.mp4"} {
			if err := os.WriteFile(filepath.Join(fx.dataDir, folder, name), []byte("x"), 0o600); err != nil {
				t.Fatal(err)
			}
		}
	}
	removed, err := RemoveOrphanClips(context.Background(), fx.db, fx.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 4 || !slices.Equal(fx.files(t), []string{kept}) || !slices.Equal(fx.filesHD(t), []string{kept}) {
		t.Errorf("removed %d, folders now %q and %q; want 4 removed and only %q", removed, fx.files(t), fx.filesHD(t), kept)
	}
}

// TestClipWithRealFFmpeg makes a small video and its clip, and checks the
// clip is a silent video of the right size and length. Skipped where
// ffmpeg or ffprobe is missing.
func TestClipWithRealFFmpeg(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not installed")
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe not installed")
	}
	tests := []struct {
		name       string
		seconds    int64
		size       string
		wantWidth  string
		wantHD     string  // width x height of the sharp clip
		wantLength float64 // seconds
	}{
		{"long, wide", 40, "1280x720", "640", "1280x720", 6},
		{"short, tall", 8, "360x640", "202", "360x640", 6},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := t.TempDir()
			name := filepath.Join(root, "mare: estate.mp4")
			if _, err := run(context.Background(), ffmpeg, "-v", "error",
				"-f", "lavfi", "-i", fmt.Sprintf("testsrc=duration=%d:size=%s:rate=25", tt.seconds, tt.size),
				"-f", "lavfi", "-i", fmt.Sprintf("sine=duration=%d", tt.seconds),
				"-g", "25", "-pix_fmt", "yuv420p", "-shortest", "file:"+name); err != nil {
				t.Fatal(err)
			}
			fx := newClipFixture(t, root, "mare: estate.mp4", tt.seconds)
			fx.c.ffmpeg = ffmpeg
			libraryBefore := listDir(t, root)

			if err := fx.c.Handle(context.Background(), fx.id); err != nil {
				t.Fatal(err)
			}
			clip := filepath.Join(fx.dataDir, ClipsDir, fx.saved(t).String)
			out, err := run(context.Background(), ffprobe, "-v", "error",
				"-show_entries", "stream=codec_type,width,height:format=duration", "-of", "flat", clip)
			if err != nil {
				t.Fatal(err)
			}
			info := string(out)
			for _, want := range []string{`codec_type="video"`, "width=" + tt.wantWidth, "height=360"} {
				if !strings.Contains(info, want) {
					t.Errorf("clip %s: no %s", info, want)
				}
			}
			if strings.Contains(info, `codec_type="audio"`) {
				t.Errorf("clip has sound: %s", info)
			}
			_, after, _ := strings.Cut(info, "format.duration=\"")
			length, err := strconv.ParseFloat(strings.TrimSuffix(strings.TrimSpace(after), "\""), 64)
			if err != nil || length < tt.wantLength-0.5 || length > tt.wantLength+0.5 {
				t.Errorf("clip lasts %v (%v), want about %v seconds", length, err, tt.wantLength)
			}
			hd, err := run(context.Background(), ffprobe, "-v", "error", "-select_streams", "v:0",
				"-show_entries", "stream=width,height", "-of", "csv=s=x:p=0",
				filepath.Join(fx.dataDir, ClipsHDDir, fx.savedHD(t).String))
			if err != nil {
				t.Fatal(err)
			}
			if got := strings.TrimSpace(string(hd)); got != tt.wantHD {
				t.Errorf("sharp clip is %s, want %s (at most 720 high, never enlarged)", got, tt.wantHD)
			}
			if after := listDir(t, root); !slices.Equal(after, libraryBefore) {
				t.Errorf("the video folder changed:\nbefore %q\nafter  %q", libraryBefore, after)
			}
		})
	}
}

func TestOwnClipWithRealFFmpeg(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not installed")
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe not installed")
	}
	fx := newClipFixture(t, t.TempDir(), "a.mp4", 600)
	fx.c.ffmpeg = ffmpeg
	// A 20-second video with sound, uploaded by the administrator.
	own := filepath.Join(fx.dataDir, OwnClipsDir, "1-0123456789abcdef.mp4")
	if err := os.MkdirAll(filepath.Dir(own), 0o750); err != nil {
		t.Fatal(err)
	}
	if _, err := run(context.Background(), ffmpeg, "-v", "error",
		"-f", "lavfi", "-i", "testsrc=duration=20:size=1280x720:rate=25",
		"-f", "lavfi", "-i", "sine=duration=20",
		"-pix_fmt", "yuv420p", "-shortest", "file:"+own); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.db.Exec(`UPDATE videos SET own_clip = ? WHERE id = ?`, filepath.Base(own), fx.id); err != nil {
		t.Fatal(err)
	}
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	out, err := run(context.Background(), ffprobe, "-v", "error",
		"-show_entries", "stream=codec_type,height:format=duration", "-of", "flat",
		filepath.Join(fx.dataDir, ClipsDir, fx.saved(t).String))
	if err != nil {
		t.Fatal(err)
	}
	info := string(out)
	if !strings.Contains(info, "height=360") || strings.Contains(info, `codec_type="audio"`) {
		t.Errorf("clip: %s, want 360 high and silent", info)
	}
	_, after, _ := strings.Cut(info, "format.duration=\"")
	if length, err := strconv.ParseFloat(strings.TrimSuffix(strings.TrimSpace(after), "\""), 64); err != nil ||
		length < 14.5 || length > 15.5 {
		t.Errorf("clip lasts %v (%v), want about 15 seconds", length, err)
	}
}
