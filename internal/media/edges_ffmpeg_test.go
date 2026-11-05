package media

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/content"
)

// shortVideo makes a video of the given length, in seconds, with real
// ffmpeg, inside a new library folder.
func shortVideo(t *testing.T, ffmpeg, length string) (root, rel string) {
	t.Helper()
	root = t.TempDir()
	rel = "corto.mp4"
	if _, err := run(context.Background(), ffmpeg, "-v", "error",
		"-f", "lavfi", "-i", "testsrc=duration="+length+":size=320x240:rate=10",
		"-pix_fmt", "yuv420p", "file:"+filepath.Join(root, rel)); err != nil {
		t.Fatal(err)
	}
	return root, rel
}

// TestCoverOfVeryShortVideosWithRealFFmpeg: the cover FranzPLAY picks by
// itself is inside the video even when it lasts less than a second, or its
// length is rounded up.
func TestCoverOfVeryShortVideosWithRealFFmpeg(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not installed")
	}
	for _, tt := range []struct {
		length   string
		duration int64 // as the probe saves it: rounded
	}{
		{"0.4", 0},
		{"0.6", 1},
		{"1.6", 2},
		{"2.6", 3},
	} {
		t.Run(tt.length+"s", func(t *testing.T) {
			root, rel := shortVideo(t, ffmpeg, tt.length)
			fx := newCoverFixture(t, root, rel)
			fx.c.ffmpeg = ffmpeg
			if _, err := fx.db.Exec(`UPDATE videos SET duration = ? WHERE id = ?`, tt.duration, fx.id); err != nil {
				t.Fatal(err)
			}
			if err := fx.c.Handle(context.Background(), fx.id); err != nil {
				t.Fatal(err)
			}
			if w, h := jpegSize(t, content.Root(fx.dataDir).File(fx.cover(t).String, "")); w != 320 || h != 240 {
				t.Errorf("cover is %dx%d, want 320x240", w, h)
			}
		})
	}
}

// TestCoverAtTheChosenMomentWithRealFFmpeg: the administrator may choose
// any second from 0 to the duration saved, which is rounded: the last one
// may be past the real end of the video.
func TestCoverAtTheChosenMomentWithRealFFmpeg(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not installed")
	}
	// 2.6 seconds, saved as 3.
	for _, second := range []int64{0, 1, 2, 3} {
		t.Run(fmt.Sprint("second ", second), func(t *testing.T) {
			root, rel := shortVideo(t, ffmpeg, "2.6")
			fx := newCoverFixture(t, root, rel)
			fx.c.ffmpeg = ffmpeg
			if _, err := fx.db.Exec(`UPDATE videos SET duration = 3, cover_second = ? WHERE id = ?`, second, fx.id); err != nil {
				t.Fatal(err)
			}
			if err := fx.c.Handle(context.Background(), fx.id); err != nil {
				t.Fatal(err)
			}
			cover := fx.cover(t)
			if !cover.Valid {
				t.Fatal("no cover saved")
			}
			if w, h := jpegSize(t, content.Root(fx.dataDir).File(cover.String, "")); w != 320 || h != 240 {
				t.Errorf("cover is %dx%d, want 320x240", w, h)
			}
		})
	}
}

// TestPreviewsOfLengthsRoundedUpWithRealFFmpeg: the saved duration is
// rounded, so the last frame asked may be just past the real end of the
// video. The previews must still be made, with every frame.
func TestPreviewsOfLengthsRoundedUpWithRealFFmpeg(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not installed")
	}
	for _, tt := range []struct {
		length   string
		duration int64
	}{
		{"3.6", 4},
		{"5.6", 6},
		{"8.5", 9},
	} {
		t.Run(tt.length+"s", func(t *testing.T) {
			root, rel := shortVideo(t, ffmpeg, tt.length)
			fx := newPreviewFixture(t, root, rel, tt.duration)
			fx.p.ffmpeg = ffmpeg
			if err := fx.p.Handle(context.Background(), fx.id); err != nil {
				t.Fatal(err)
			}
			s := fx.saved(t)
			if !s.name.Valid || s.count.Int64 < 2 {
				t.Fatalf("saved %+v, want previews", s)
			}
			columns, rows := min(s.count.Int64, 10), (s.count.Int64+9)/10
			w, h := jpegSize(t, content.Root(fx.dataDir).File(s.name.String, ""))
			if int64(w) != columns*s.width.Int64 || int64(h) != rows*s.height.Int64 {
				t.Errorf("image is %dx%d for %d frames of %dx%d", w, h, s.count.Int64, s.width.Int64, s.height.Int64)
			}
		})
	}
}
