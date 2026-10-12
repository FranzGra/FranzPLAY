package media

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestCoverSecond(t *testing.T) {
	tests := map[int64]int64{0: 0, 1: 0, 2: 1, 9: 1, 30: 3, 300: 30, 600: 60, 7200: 60}
	for duration, want := range tests {
		if got := coverSecond(duration); got != want {
			t.Errorf("coverSecond(%d) = %d, want %d", duration, got, want)
		}
	}
}

func TestCoverNameChangesWithContent(t *testing.T) {
	a := coverName(7, "v1:aaaaaaaa11111111")
	b := coverName(7, "v1:aaaaaaaa22222222")
	if a == b {
		t.Errorf("same cover name %q for different content", a)
	}
	if a != "7-11111111.jpg" {
		t.Errorf("coverName = %q", a)
	}
}

func TestCoverArgsPrefersAnImageNextToTheVideo(t *testing.T) {
	dir := t.TempDir()
	video := filepath.Join(dir, "mare.mp4")
	c := &Coverer{}

	args := c.coverArgs(video, 300, "", "out.jpg")
	if !slices.Contains(args, "file:"+video) || !slices.Contains(args, "30") {
		t.Errorf("without an image: %q, want a frame at second 30 of the video", args)
	}

	// A picture found on the internet comes before a frame of the video.
	downloaded := filepath.Join(dir, "data", "online", "7-1234.img")
	args = c.coverArgs(video, 300, downloaded, "out.jpg")
	if !slices.Contains(args, "file:"+downloaded) || slices.Contains(args, "file:"+video) {
		t.Errorf("with a picture from the internet: %q", args)
	}

	poster := filepath.Join(dir, "mare-poster.jpg")
	if err := os.WriteFile(poster, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	// An image next to the video comes before the internet's.
	args = c.coverArgs(video, 300, downloaded, "out.jpg")
	if !slices.Contains(args, "file:"+poster) || slices.Contains(args, "file:"+video) {
		t.Errorf("with mare-poster.jpg: %q", args)
	}

	// mare.jpg comes before mare-poster.jpg.
	plain := filepath.Join(dir, "mare.jpg")
	if err := os.WriteFile(plain, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if args = c.coverArgs(video, 300, "", "out.jpg"); !slices.Contains(args, "file:"+plain) {
		t.Errorf("with mare.jpg: %q", args)
	}
}

// coverFixture is a catalog with one video and a coverer on a temp data folder.
type coverFixture struct {
	db      *sql.DB
	id      int64
	dataDir string
	c       *Coverer
}

func newCoverFixture(t *testing.T, root, rel string) *coverFixture {
	t.Helper()
	db, id := catalog(t, root, rel)
	dataDir := t.TempDir()
	return &coverFixture{db: db, id: id, dataDir: dataDir, c: NewCoverer(db, "ffmpeg", dataDir)}
}

func (fx *coverFixture) cover(t *testing.T) sql.NullString {
	t.Helper()
	var s sql.NullString
	if err := fx.db.QueryRow(`SELECT cover FROM videos WHERE id = ?`, fx.id).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func (fx *coverFixture) files(t *testing.T) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(fx.dataDir, CoversDir))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

// fakeFFmpeg pretends to be ffmpeg: it writes content to the output file
// (the last argument), then returns err.
func fakeFFmpeg(content string, err error) runFunc {
	return func(_ context.Context, _ string, args ...string) ([]byte, error) {
		out := strings.TrimPrefix(args[len(args)-1], "file:")
		if content != "" {
			if werr := os.WriteFile(out, []byte(content), 0o600); werr != nil {
				return nil, werr
			}
		}
		return nil, err
	}
}

func TestCoverFailuresLeaveNothingBehind(t *testing.T) {
	tests := []struct {
		name string
		run  runFunc
	}{
		{"ffmpeg fails", fakeFFmpeg("", errors.New("exit status 1"))},
		{"ffmpeg fails after writing half a file", fakeFFmpeg("half", errors.New("killed"))},
		{"ffmpeg writes nothing", fakeFFmpeg("", nil)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fx := newCoverFixture(t, "/videos", "a.mp4")
			fx.c.run = tt.run
			if err := fx.c.Handle(context.Background(), fx.id); err == nil {
				t.Fatal("no error")
			}
			if files := fx.files(t); len(files) != 0 {
				t.Errorf("files left in the covers folder: %q", files)
			}
			if fx.cover(t).Valid {
				t.Error("cover saved after a failure")
			}
		})
	}
}

func TestNewCoverReplacesTheOldOne(t *testing.T) {
	fx := newCoverFixture(t, "/videos", "a.mp4")
	fx.c.run = fakeFFmpeg("jpeg", nil)
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	first := fx.cover(t).String

	// The file is replaced with a new version.
	if _, err := fx.db.Exec(`UPDATE videos SET fingerprint = 'v1:new-content' WHERE id = ?`, fx.id); err != nil {
		t.Fatal(err)
	}
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	second := fx.cover(t).String
	if second == first {
		t.Fatalf("cover name did not change: %q", second)
	}
	if files := fx.files(t); !slices.Equal(files, []string{second}) {
		t.Errorf("covers folder = %q, want only %q", files, second)
	}
}

func TestCoverOfContentThatChangedMeanwhileIsDropped(t *testing.T) {
	fx := newCoverFixture(t, "/videos", "a.mp4")
	write := fakeFFmpeg("jpeg", nil)
	fx.c.run = func(ctx context.Context, program string, args ...string) ([]byte, error) {
		if _, err := fx.db.Exec(`UPDATE videos SET fingerprint = 'v1:other' WHERE id = ?`, fx.id); err != nil {
			t.Fatal(err)
		}
		return write(ctx, program, args...)
	}
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if fx.cover(t).Valid || len(fx.files(t)) != 0 {
		t.Errorf("cover of the old content kept: %v %q", fx.cover(t), fx.files(t))
	}
}

func TestRemoveOrphanCovers(t *testing.T) {
	fx := newCoverFixture(t, "/videos", "a.mp4")
	fx.c.run = fakeFFmpeg("jpeg", nil)
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	kept := fx.cover(t).String
	dir := filepath.Join(fx.dataDir, CoversDir)
	for _, name := range []string{"99-forgotten.jpg", ".new-123.jpg"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	removed, err := RemoveOrphanCovers(context.Background(), fx.db, fx.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 2 || !slices.Equal(fx.files(t), []string{kept}) {
		t.Errorf("removed %d, folder now %q; want 2 removed and only %q", removed, fx.files(t), kept)
	}

	if n, err := RemoveOrphanCovers(context.Background(), fx.db, t.TempDir()); err != nil || n != 0 {
		t.Errorf("data folder with no covers: %d, %v", n, err)
	}
}

func TestProberAsksForTheCoverThePreviewsAndTheSubtitles(t *testing.T) {
	db, id := catalog(t, "/videos", "a.mp4")
	var args []string
	p := NewProber(db, "ffprobe")
	p.run = fakeRun(`{"streams":[{"codec_type":"video","codec_name":"h264","width":2,"height":2}]}`, nil, &args)
	if err := p.Handle(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"cover", "preview", "tracks", "convert"} {
		var state string
		if err := db.QueryRow(`SELECT state FROM jobs WHERE video_id = ? AND kind = ?`, id, kind).Scan(&state); err != nil {
			t.Fatalf("no %s job: %v", kind, err)
		}
		if state != "pending" {
			t.Errorf("%s job state = %q, want pending", kind, state)
		}
	}
}

// TestCoverWithRealFFmpeg makes a small video and a cover from it, then a
// cover from an image next to the video. Skipped where ffmpeg is missing.
func TestCoverWithRealFFmpeg(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not installed")
	}
	root := t.TempDir()
	video := filepath.Join(root, "Viaggi", "mare: estate.mp4")
	if err := os.MkdirAll(filepath.Dir(video), 0o750); err != nil {
		t.Fatal(err)
	}
	if _, err := run(context.Background(), ffmpeg, "-v", "error",
		"-f", "lavfi", "-i", "testsrc=duration=3:size=1280x720:rate=10",
		"-pix_fmt", "yuv420p", "file:"+video); err != nil {
		t.Fatal(err)
	}

	fx := newCoverFixture(t, root, "Viaggi/mare: estate.mp4")
	fx.c.ffmpeg = ffmpeg
	if _, err := fx.db.Exec(`UPDATE videos SET duration = 3 WHERE id = ?`, fx.id); err != nil {
		t.Fatal(err)
	}
	libraryBefore := listDir(t, root)

	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if w, h := jpegSize(t, filepath.Join(fx.dataDir, CoversDir, fx.cover(t).String)); w != 640 || h != 360 {
		t.Errorf("cover from a frame is %dx%d, want 640x360", w, h)
	}
	if after := listDir(t, root); !slices.Equal(after, libraryBefore) {
		t.Errorf("video folder changed: %q, before %q", after, libraryBefore)
	}

	// A small image next to the video wins, and is not enlarged.
	poster := filepath.Join(root, "Viaggi", "mare: estate.png")
	if _, err := run(context.Background(), ffmpeg, "-v", "error",
		"-f", "lavfi", "-i", "color=c=red:size=300x400", "-frames:v", "1", "file:"+poster); err != nil {
		t.Fatal(err)
	}
	libraryBefore = listDir(t, root)
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if w, h := jpegSize(t, filepath.Join(fx.dataDir, CoversDir, fx.cover(t).String)); w != 300 || h != 400 {
		t.Errorf("cover from the image is %dx%d, want 300x400", w, h)
	}

	if after := listDir(t, root); !slices.Equal(after, libraryBefore) {
		t.Errorf("video folder changed: %q, before %q", after, libraryBefore)
	}
	if files := fx.files(t); len(files) != 1 {
		t.Errorf("covers folder = %q, want just one cover", files)
	}
}

func jpegSize(t *testing.T, name string) (int, int) {
	t.Helper()
	data, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("%s is not a JPEG: %v", name, err)
	}
	return cfg.Width, cfg.Height
}

// listDir describes every file under root with its size and date.
func listDir(t *testing.T, root string) []string {
	t.Helper()
	var out []string
	err := filepath.WalkDir(root, func(name string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		out = append(out, fmt.Sprintf("%s %s %s %d", name, info.ModTime(), info.Mode(), info.Size()))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}
