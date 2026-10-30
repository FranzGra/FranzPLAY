package media

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"image/color"
	"image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
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
	name                      sql.NullString
	gap, count, width, height sql.NullInt64
}

func (fx *previewFixture) saved(t *testing.T) savedPreview {
	t.Helper()
	var s savedPreview
	if err := fx.db.QueryRow(`SELECT preview, preview_gap, preview_count, preview_width, preview_height
		FROM videos WHERE id = ?`, fx.id).Scan(&s.name, &s.gap, &s.count, &s.width, &s.height); err != nil {
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

// fakeFFmpegFrames pretends to be ffmpeg on a video of length seconds:
// asked for the frame at a second (-ss) it writes it if the video lasts
// that long; asked to join the frames it writes the image. A step named
// in fail fails: "frames" the first frame, "join" the join.
type fakeFFmpegFrames struct {
	length  int64
	fail    string
	calls   []string
	seconds []int64 // the seconds asked, in order
}

func (f *fakeFFmpegFrames) run(_ context.Context, _ string, args ...string) ([]byte, error) {
	out := strings.TrimPrefix(args[len(args)-1], "file:")
	i := slices.Index(args, "-ss")
	if i < 0 {
		f.calls = append(f.calls, "join")
		if f.fail == "join" {
			return nil, errors.New("exit status 1")
		}
		return nil, os.WriteFile(out, []byte("jpeg"), 0o600)
	}
	f.calls = append(f.calls, "frame")
	second, err := strconv.ParseInt(args[i+1], 10, 64)
	if err != nil {
		return nil, err
	}
	f.seconds = append(f.seconds, second)
	if f.fail == "frames" {
		return nil, errors.New("exit status 1")
	}
	if second >= f.length {
		// Like ffmpeg 7: nothing to encode is a failure.
		return nil, errors.New("exit status 234: Nothing was written into output file")
	}
	return nil, os.WriteFile(out, []byte("f"), 0o600)
}

func TestPreviewsSaved(t *testing.T) {
	fx := newPreviewFixture(t, "/videos", "a.mp4", 252)
	var joined []string
	fake := &fakeFFmpegFrames{length: 252}
	fx.p.run = func(ctx context.Context, program string, args ...string) ([]byte, error) {
		joined = args
		return fake.run(ctx, program, args...)
	}
	if err := fx.p.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	s := fx.saved(t)
	if s.name.String != "1-fp-w480t.jpg" || s.gap.Int64 != 3 || s.count.Int64 != 84 ||
		s.width.Int64 != 480 || s.height.Int64 != 270 {
		t.Errorf("saved %+v, want 84 frames of 480x270 every 3 seconds", s)
	}
	if !slices.Contains(joined, "tile=10x9") {
		t.Errorf("join command %q, want a 10x9 grid", joined)
	}
	if files := fx.files(t); !slices.Equal(files, []string{"1-fp-w480t.jpg"}) {
		t.Errorf("previews folder = %q", files)
	}
	if n := len(fake.calls); n != 85 || fake.calls[n-1] != "join" {
		t.Errorf("ffmpeg ran %d times (%q…), want 84 frames then join", n, fake.calls[:min(n, 3)])
	}
}

// TestPreviewFramesAtTheirSeconds: frame i is the picture at second
// i*gap, from the start to the end of the video, each asked once.
func TestPreviewFramesAtTheirSeconds(t *testing.T) {
	tests := []struct {
		name             string
		duration, length int64 // stated, and how long the file really lasts
		want             []int64
	}{
		{"18 seconds", 18, 18, []int64{0, 2, 4, 6, 8, 10, 12, 14, 16}},
		{"odd length", 9, 9, []int64{0, 2, 4, 6, 8}},
		// The file ends before its stated duration: the second with no
		// picture ends the list.
		{"ends early", 18, 13, []int64{0, 2, 4, 6, 8, 10, 12, 14}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fx := newPreviewFixture(t, "/videos", "a.mp4", tt.duration)
			fake := &fakeFFmpegFrames{length: tt.length}
			fx.p.run = fake.run
			if err := fx.p.Handle(context.Background(), fx.id); err != nil {
				t.Fatal(err)
			}
			if !slices.Equal(fake.seconds, tt.want) {
				t.Errorf("seconds asked %v, want %v", fake.seconds, tt.want)
			}
			wantCount := int64(len(tt.want))
			if tt.length < tt.duration {
				wantCount-- // the last one asked had no picture
			}
			if s := fx.saved(t); s.count.Int64 != wantCount || s.gap.Int64 != 2 {
				t.Errorf("saved %+v, want %d frames every 2 seconds", s, wantCount)
			}
		})
	}
}

func TestFrameCount(t *testing.T) {
	for _, tt := range []struct{ duration, gap, want int64 }{
		{18, 2, 9}, {17, 2, 9}, {16, 2, 8}, {600, 6, 100}, {7200, 72, 100}, {7201, 73, 99}, {0, 2, 0}, {10, 0, 0},
	} {
		if got := frameCount(tt.duration, tt.gap); int64(got) != tt.want {
			t.Errorf("frameCount(%d, %d) = %d, want %d", tt.duration, tt.gap, got, tt.want)
		}
	}
}

// TestPreviewsMadeAgainReplaceTheOldImage: an image made by an older
// version, with smaller frames and the old name, is replaced by the new
// one under a new name, so no browser keeps showing the old one.
func TestPreviewsMadeAgainReplaceTheOldImage(t *testing.T) {
	fx := newPreviewFixture(t, "/videos", "a.mp4", 600)
	dir := filepath.Join(fx.dataDir, PreviewsDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	for _, old := range []string{"1-fp.jpg", "1-fp-w480.jpg"} {
		if err := os.WriteFile(filepath.Join(dir, old), []byte("old"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := fx.db.Exec(`UPDATE videos SET preview = '1-fp-w480.jpg', preview_gap = 6, preview_count = 100,
		preview_width = 480, preview_height = 270 WHERE id = ?`, fx.id); err != nil {
		t.Fatal(err)
	}
	fx.p.run = (&fakeFFmpegFrames{length: 600}).run
	if err := fx.p.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if s := fx.saved(t); s.name.String != "1-fp-w480t.jpg" || s.width.Int64 != 480 || s.height.Int64 != 270 {
		t.Errorf("saved %+v, want the new image with 480x270 frames", s)
	}
	// The image of an even older version is not anybody's any more: the
	// cleaning at start removes it (TestRemoveOrphanPreviews).
	if files := fx.files(t); !slices.Equal(files, []string{"1-fp-w480t.jpg", "1-fp.jpg"}) {
		t.Errorf("previews folder = %q, want the new image instead of the one it replaces", files)
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
		{"frames fail", (&fakeFFmpegFrames{length: 60, fail: "frames"}).run},
		{"no frames at all", (&fakeFFmpegFrames{}).run},
		{"joining fails", (&fakeFFmpegFrames{length: 60, fail: "join"}).run},
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
	fake := &fakeFFmpegFrames{length: 60}
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
	fx.p.run = (&fakeFFmpegFrames{length: 60}).run
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
		name              string
		seconds, keyEvery int64 // keyEvery in frames, at 10 per second
		gap, count        int64
	}{
		{"key frame every second", 30, 10, 2, 15},
		{"one key frame", 7, 1000, 2, 4},
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
			if s.gap.Int64 != tt.gap || s.count.Int64 != tt.count {
				t.Errorf("saved %+v, want %d frames every %d seconds", s, tt.count, tt.gap)
			}
			columns := min(s.count.Int64, 10)
			rows := (s.count.Int64 + columns - 1) / columns
			w, h := jpegSize(t, filepath.Join(fx.dataDir, PreviewsDir, s.name.String))
			if int64(w) != columns*480 || int64(h) != rows*270 {
				t.Errorf("image is %dx%d, want %dx%d", w, h, columns*480, rows*270)
			}
			if after := listDir(t, root); !slices.Equal(after, libraryBefore) {
				t.Errorf("the video folder changed:\nbefore %q\nafter  %q", libraryBefore, after)
			}
		})
	}
}

// TestPreviewFramesAreTheRealOnesWithRealFFmpeg makes an 18 second video
// whose brightness is 10 times the second, with a key frame only every
// 8.3 seconds, and checks each frame is the picture of its own second,
// the end of the video included. Read from key frames only, as before,
// most frames were the one at 0 or 8.3 seconds and the last ones missed.
func TestPreviewFramesAreTheRealOnesWithRealFFmpeg(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not installed")
	}
	root := t.TempDir()
	name := filepath.Join(root, "luce.mp4")
	if _, err := run(context.Background(), ffmpeg, "-v", "error",
		"-f", "lavfi", "-i", "nullsrc=s=320x240:r=12:d=18,geq=lum='10*T':cb=128:cr=128",
		"-c:v", "libx264", "-g", "100", "-keyint_min", "100", "-sc_threshold", "0",
		"-pix_fmt", "yuv420p", "file:"+name); err != nil {
		t.Fatal(err)
	}
	fx := newPreviewFixture(t, root, "luce.mp4", 18)
	fx.p.ffmpeg = ffmpeg
	work := t.TempDir()
	count, err := fx.p.frames(context.Background(), name, 18, 2, work)
	if err != nil {
		t.Fatal(err)
	}
	if count != 9 {
		t.Fatalf("%d frames, want 9 (seconds 0 to 16)", count)
	}
	luma := make([]float64, count)
	for i := range count {
		luma[i] = centerLuma(t, filepath.Join(work, fmt.Sprintf(frameName, i+1)))
	}
	// Two seconds apart, the brightness grows by 20, a little more after
	// the move from video levels to full ones (16-235 to 0-255) and a
	// little off after JPEG. At second 0 it is below black: cut to 0.
	if luma[1] <= luma[0] {
		t.Errorf("frame 1 (%.0f) not brighter than frame 0 (%.0f)", luma[1], luma[0])
	}
	for i := 2; i < count; i++ {
		if d := luma[i] - luma[i-1]; d < 15 || d > 30 {
			t.Errorf("frames %d and %d (seconds %d and %d): brightness %.0f then %.0f, want about 20-23 more",
				i-1, i, (i-1)*2, i*2, luma[i-1], luma[i])
		}
	}
}

// centerLuma is the brightness of the middle of a JPEG, from 0 to 255.
func centerLuma(t *testing.T, name string) float64 {
	t.Helper()
	f, err := os.Open(name)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := f.Close(); err != nil {
			t.Error(err)
		}
	}()
	img, err := jpeg.Decode(f)
	if err != nil {
		t.Fatal(err)
	}
	b := img.Bounds()
	y, _, _ := color.RGBToYCbCr(rgb8(img.At(b.Dx()/2, b.Dy()/2)))
	return float64(y)
}

func rgb8(c color.Color) (uint8, uint8, uint8) {
	r, g, b, _ := c.RGBA()
	return uint8(r >> 8), uint8(g >> 8), uint8(b >> 8)
}

// TestFrameArgsJumpToTheSecond: -ss comes before the input, so ffmpeg
// jumps near the second instead of decoding the video up to it, and it
// writes a single image.
func TestFrameArgsJumpToTheSecond(t *testing.T) {
	args := frameArgs("a.mp4", 42, "work/001.jpg")
	ss, in := slices.Index(args, "-ss"), slices.Index(args, "-i")
	if ss < 0 || args[ss+1] != "42" || ss > in || args[in+1] != "file:a.mp4" {
		t.Errorf("args %q, want -ss 42 before -i", args)
	}
	if i := slices.Index(args, "-frames:v"); i < 0 || args[i+1] != "1" || slices.Contains(args, "-skip_frame") {
		t.Errorf("args %q, want one frame, every frame decoded", args)
	}
}
