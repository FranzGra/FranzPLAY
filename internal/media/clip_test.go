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

func (fx *clipFixture) saved(t *testing.T) sql.NullString {
	t.Helper()
	var name sql.NullString
	if err := fx.db.QueryRow(`SELECT clip FROM videos WHERE id = ?`, fx.id).Scan(&name); err != nil {
		t.Fatal(err)
	}
	return name
}

func (fx *clipFixture) files(t *testing.T) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(fx.dataDir, ClipsDir))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

// fakeClipFFmpeg pretends to be ffmpeg: it writes data in the file it is
// asked for, then fails with err.
func fakeClipFFmpeg(data string, err error) runFunc {
	return func(_ context.Context, _ string, args ...string) ([]byte, error) {
		out := strings.TrimPrefix(args[len(args)-1], "file:")
		if writeErr := os.WriteFile(out, []byte(data), 0o600); writeErr != nil {
			return nil, writeErr
		}
		return nil, err
	}
}

func TestClipSaved(t *testing.T) {
	fx := newClipFixture(t, "/videos", "a.mp4", 600)
	var got []string
	fx.c.run = func(ctx context.Context, program string, args ...string) ([]byte, error) {
		got = args
		return fakeClipFFmpeg("clip", nil)(ctx, program, args...)
	}
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if s := fx.saved(t); s.String != "1-fp.mp4" {
		t.Errorf("saved %+v, want 1-fp.mp4", s)
	}
	if files := fx.files(t); !slices.Equal(files, []string{"1-fp.mp4"}) {
		t.Errorf("clips folder = %q", files)
	}
	// Three moments, each read straight from its place.
	var starts []string
	for i, a := range got {
		if a == "-ss" {
			starts = append(starts, got[i+1])
		}
	}
	if !slices.Equal(starts, []string{"150", "300", "450"}) {
		t.Errorf("ffmpeg starts at %q, want 150, 300 and 450", starts)
	}
	joined := strings.Join(got, " ")
	for _, want := range []string{"concat=n=3:v=1:a=0", "scale=-2:360", "-an", "+faststart", "file:/videos/a.mp4"} {
		if !strings.Contains(joined, want) {
			t.Errorf("ffmpeg command %q has no %q", joined, want)
		}
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
	for _, want := range []string{"-t 15 -i " + uploaded, "scale=-2:360", "-an", "+faststart"} {
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

	// No clip at all: the clip goes, and ffmpeg is not even run.
	got = nil
	if _, err := fx.db.Exec(`UPDATE videos SET own_clip = NULL, no_clip = 1 WHERE id = ?`, fx.id); err != nil {
		t.Fatal(err)
	}
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if s := fx.saved(t); s.Valid || got != nil {
		t.Errorf("saved %+v, ffmpeg %q; want no clip and no ffmpeg", s, got)
	}
	if files := fx.files(t); len(files) != 0 {
		t.Errorf("clips folder = %q, want empty", files)
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
			if files := fx.files(t); len(files) != 0 {
				t.Errorf("files left in the clips folder: %q", files)
			}
			if s := fx.saved(t); s.Valid {
				t.Error("clip saved after a failure")
			}
		})
	}
}

func TestClipReplacesTheOldOne(t *testing.T) {
	fx := newClipFixture(t, "/videos", "a.mp4", 60)
	dir := filepath.Join(fx.dataDir, ClipsDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "1-old.mp4"), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.db.Exec(`UPDATE videos SET clip = '1-old.mp4' WHERE id = ?`, fx.id); err != nil {
		t.Fatal(err)
	}
	fx.c.run = fakeClipFFmpeg("new", nil)
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if files := fx.files(t); !slices.Equal(files, []string{"1-fp.mp4"}) {
		t.Errorf("clips folder = %q, want only the new clip", files)
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
	if fx.saved(t).Valid || len(fx.files(t)) != 0 {
		t.Errorf("clip of the old content kept: %+v %q", fx.saved(t), fx.files(t))
	}
}

func TestRemoveOrphanClips(t *testing.T) {
	fx := newClipFixture(t, "/videos", "a.mp4", 60)
	fx.c.run = fakeClipFFmpeg("clip", nil)
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	kept := fx.saved(t).String
	dir := filepath.Join(fx.dataDir, ClipsDir)
	// A forgotten clip, and one left half made by a crash.
	for _, name := range []string{"99-forgotten.mp4", ".new-123.mp4"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	removed, err := RemoveOrphanClips(context.Background(), fx.db, fx.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 2 || !slices.Equal(fx.files(t), []string{kept}) {
		t.Errorf("removed %d, folder now %q; want 2 removed and only %q", removed, fx.files(t), kept)
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
		wantLength float64 // seconds
	}{
		{"long, wide", 40, "1280x720", "640", 6},
		{"short, tall", 8, "360x640", "202", 6},
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
