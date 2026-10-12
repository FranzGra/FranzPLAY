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
	"strings"
	"testing"
)

// previewFixture is a catalog with one video of the given duration and a
// previewer on a temp data folder.
type previewFixture struct {
	db      *sql.DB
	id      int64
	dataDir string
	p       *Previewer
}

func newPreviewFixture(t *testing.T, root, rel string, duration int64) *previewFixture {
	t.Helper()
	db, id := catalog(t, root, rel)
	if _, err := db.Exec(`UPDATE videos SET duration = ? WHERE id = ?`, duration, id); err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	return &previewFixture{db: db, id: id, dataDir: dataDir, p: NewPreviewer(db, "ffmpeg", dataDir)}
}

type savedPreview struct {
	name       sql.NullString
	gap, count sql.NullInt64
}

func (fx *previewFixture) saved(t *testing.T) savedPreview {
	t.Helper()
	var s savedPreview
	if err := fx.db.QueryRow(`SELECT preview, preview_gap, preview_count FROM videos WHERE id = ?`, fx.id).
		Scan(&s.name, &s.gap, &s.count); err != nil {
		t.Fatal(err)
	}
	return s
}

func (fx *previewFixture) files(t *testing.T) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(fx.dataDir, PreviewsDir))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

// fakeFFmpegFrames pretends to be ffmpeg: asked for single frames it
// writes keyFrames of them, or allFrames when told to read every frame;
// asked to join them it writes the image. A step named in fail fails.
type fakeFFmpegFrames struct {
	keyFrames, allFrames int
	fail                 string // "frames", "all frames" or "join"
	calls                []string
}

func (f *fakeFFmpegFrames) run(_ context.Context, _ string, args ...string) ([]byte, error) {
	out := strings.TrimPrefix(args[len(args)-1], "file:")
	step, n := "join", 0
	if strings.HasSuffix(out, frameName) {
		step, n = "all frames", f.allFrames
		if slices.Contains(args, "-skip_frame") {
			step, n = "frames", f.keyFrames
		}
	}
	f.calls = append(f.calls, step)
	if step == "join" {
		if err := os.WriteFile(out, []byte("jpeg"), 0o600); err != nil {
			return nil, err
		}
	}
	for i := 1; i <= n; i++ {
		if err := os.WriteFile(filepath.Join(filepath.Dir(out), fmt.Sprintf("%03d.jpg", i)), []byte("f"), 0o600); err != nil {
			return nil, err
		}
	}
	if step == f.fail {
		return nil, errors.New("exit status 1")
	}
	return nil, nil
}

func TestPreviewsSaved(t *testing.T) {
	fx := newPreviewFixture(t, "/videos", "a.mp4", 600)
	var joined []string
	fake := &fakeFFmpegFrames{keyFrames: 42}
	fx.p.run = func(ctx context.Context, program string, args ...string) ([]byte, error) {
		joined = args
		return fake.run(ctx, program, args...)
	}
	if err := fx.p.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	s := fx.saved(t)
	if s.name.String != "1-fp.jpg" || s.gap.Int64 != 6 || s.count.Int64 != 42 {
		t.Errorf("saved %+v, want 42 frames every 6 seconds", s)
	}
	if !slices.Contains(joined, "tile=10x5") {
		t.Errorf("join command %q, want a 10x5 grid", joined)
	}
	if files := fx.files(t); !slices.Equal(files, []string{"1-fp.jpg"}) {
		t.Errorf("previews folder = %q", files)
	}
	if !slices.Equal(fake.calls, []string{"frames", "join"}) {
		t.Errorf("ffmpeg ran for %q, want only key frames then join", fake.calls)
	}
}

func TestPreviewsOfAVideoWithOneKeyFrame(t *testing.T) {
	fx := newPreviewFixture(t, "/videos", "a.mp4", 7)
	fake := &fakeFFmpegFrames{keyFrames: 0, allFrames: 4}
	fx.p.run = fake.run
	if err := fx.p.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if s := fx.saved(t); s.count.Int64 != 4 {
		t.Errorf("saved %+v, want the 4 frames read one by one", s)
	}
	if !slices.Equal(fake.calls, []string{"frames", "all frames", "join"}) {
		t.Errorf("ffmpeg ran for %q", fake.calls)
	}
}

func TestPreviewsOfAShortVideo(t *testing.T) {
	fx := newPreviewFixture(t, "/videos", "a.mp4", 3)
	fx.p.run = func(context.Context, string, ...string) ([]byte, error) {
		t.Fatal("ffmpeg must not run for a 3 second video")
		return nil, nil
	}
	if err := fx.p.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if s := fx.saved(t); s.name.Valid {
		t.Errorf("previews saved: %+v", s)
	}
}

func TestPreviewFailuresLeaveNothingBehind(t *testing.T) {
	tests := []struct {
		name string
		run  runFunc
	}{
		{"frames fail", (&fakeFFmpegFrames{keyFrames: 3, fail: "frames"}).run},
		{"no frames at all", (&fakeFFmpegFrames{}).run},
		{"reading every frame fails", (&fakeFFmpegFrames{allFrames: 3, fail: "all frames"}).run},
		{"joining fails", (&fakeFFmpegFrames{keyFrames: 3, fail: "join"}).run},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fx := newPreviewFixture(t, "/videos", "a.mp4", 60)
			fx.p.run = tt.run
			if err := fx.p.Handle(context.Background(), fx.id); err == nil {
				t.Fatal("no error")
			}
			if files := fx.files(t); len(files) != 0 {
				t.Errorf("files left in the previews folder: %q", files)
			}
			if s := fx.saved(t); s.name.Valid {
				t.Error("previews saved after a failure")
			}
		})
	}
}

func TestPreviewsOfContentThatChangedMeanwhileAreDropped(t *testing.T) {
	fx := newPreviewFixture(t, "/videos", "a.mp4", 60)
	fake := &fakeFFmpegFrames{keyFrames: 30}
	fx.p.run = func(ctx context.Context, program string, args ...string) ([]byte, error) {
		if _, err := fx.db.Exec(`UPDATE videos SET fingerprint = 'v1:other' WHERE id = ?`, fx.id); err != nil {
			t.Fatal(err)
		}
		return fake.run(ctx, program, args...)
	}
	if err := fx.p.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if fx.saved(t).name.Valid || len(fx.files(t)) != 0 {
		t.Errorf("previews of the old content kept: %+v %q", fx.saved(t), fx.files(t))
	}
}

func TestRemoveOrphanPreviews(t *testing.T) {
	fx := newPreviewFixture(t, "/videos", "a.mp4", 60)
	fx.p.run = (&fakeFFmpegFrames{keyFrames: 30}).run
	if err := fx.p.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	kept := fx.saved(t).name.String
	dir := filepath.Join(fx.dataDir, PreviewsDir)
	if err := os.WriteFile(filepath.Join(dir, "99-forgotten.jpg"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	// Work left by a crash, and a folder that is not FranzPLAY's.
	for _, d := range []string{".new-123", "someone-else"} {
		if err := os.MkdirAll(filepath.Join(dir, d), 0o750); err != nil {
			t.Fatal(err)
		}
	}

	removed, err := RemoveOrphanPreviews(context.Background(), fx.db, fx.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{kept, "someone-else"}; removed != 2 || !slices.Equal(fx.files(t), want) {
		t.Errorf("removed %d, folder now %q; want 2 removed and %q", removed, fx.files(t), want)
	}
}

// TestPreviewsWithRealFFmpeg makes small videos and their previews: one
// with a key frame every second, like most cameras and phones make, and
// a short one with a single key frame. Skipped where ffmpeg is missing.
func TestPreviewsWithRealFFmpeg(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not installed")
	}
	tests := []struct {
		name               string
		seconds, keyEvery  int64 // keyEvery in frames, at 10 per second
		gap                int64
		minCount, maxCount int64
	}{
		{"key frame every second", 30, 10, 2, 14, 15},
		{"one key frame", 7, 1000, 2, 3, 4},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := t.TempDir()
			name := filepath.Join(root, "mare: estate.mp4")
			if _, err := run(context.Background(), ffmpeg, "-v", "error",
				"-f", "lavfi", "-i", fmt.Sprintf("testsrc=duration=%d:size=640x480:rate=10", tt.seconds),
				"-g", fmt.Sprint(tt.keyEvery), "-pix_fmt", "yuv420p", "file:"+name); err != nil {
				t.Fatal(err)
			}
			fx := newPreviewFixture(t, root, "mare: estate.mp4", tt.seconds)
			fx.p.ffmpeg = ffmpeg
			libraryBefore := listDir(t, root)

			if err := fx.p.Handle(context.Background(), fx.id); err != nil {
				t.Fatal(err)
			}
			s := fx.saved(t)
			if s.gap.Int64 != tt.gap || s.count.Int64 < tt.minCount || s.count.Int64 > tt.maxCount {
				t.Errorf("saved %+v, want %d-%d frames every %d seconds", s, tt.minCount, tt.maxCount, tt.gap)
			}
			columns := min(s.count.Int64, 10)
			rows := (s.count.Int64 + columns - 1) / columns
			w, h := jpegSize(t, filepath.Join(fx.dataDir, PreviewsDir, s.name.String))
			if int64(w) != columns*160 || int64(h) != rows*90 {
				t.Errorf("image is %dx%d, want %dx%d", w, h, columns*160, rows*90)
			}
			if after := listDir(t, root); !slices.Equal(after, libraryBefore) {
				t.Errorf("the video folder changed:\nbefore %q\nafter  %q", libraryBefore, after)
			}
		})
	}
}
