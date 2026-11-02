package media

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// Previewer makes the previews with ffmpeg.
type Previewer struct {
	db     *sql.DB
	ffmpeg string // program to run
	root   content.Root
	run    runFunc
}

// NewPreviewer returns a previewer that runs the given ffmpeg program and
// writes previews in the folder of each video, in root.
func NewPreviewer(db *sql.DB, ffmpeg string, root content.Root) *Previewer {
	return &Previewer{db: db, ffmpeg: ffmpeg, root: root, run: runInBackground}
}

// Handle is the job handler for jobs.Preview. It works in two steps:
// ffmpeg writes one small frame every few seconds, frame i (from 0) being
// the real picture at second i*gap, then joins them in one image. The
// player and the cover choice rely on that: frame i is second i*gap.
// Counting the frames in between says exactly how many there are, even
// when the video ends a little before its stated duration.
func (p *Previewer) Handle(ctx context.Context, videoID int64) (err error) {
	file, fingerprint, err := locate(ctx, p.db, videoID)
	if err != nil {
		return err
	}
	var duration sql.NullInt64
	var old sql.NullString
	if err := p.db.QueryRowContext(ctx, `SELECT duration, preview FROM videos WHERE id = ?`, videoID).
		Scan(&duration, &old); err != nil {
		return fmt.Errorf("read video %d: %w", videoID, err)
	}
	gap := video.PreviewGap(duration.Int64)
	if gap == 0 {
		return nil // too short to need previews
	}

	code, err := content.EnsureVideoFolder(ctx, p.db, p.root, videoID, fingerprint)
	if err != nil {
		return err
	}
	dir, err := p.root.MakeWork()
	if err != nil {
		return err
	}
	// Rule 6: everything is made in a temporary folder, and the finished
	// image is moved out only at the end.
	work, err := os.MkdirTemp(dir, ".new-*")
	if err != nil {
		return fmt.Errorf("previews of video %d: %w", videoID, err)
	}
	defer func() {
		if rmErr := os.RemoveAll(work); rmErr != nil {
			err = errors.Join(err, rmErr)
		}
	}()

	count, err := p.frames(ctx, file, duration.Int64, gap, work)
	if err != nil {
		return fmt.Errorf("previews of video %d: %w", videoID, err)
	}
	if count == 0 {
		return fmt.Errorf("previews of video %d: ffmpeg wrote no image", videoID)
	}
	sprite := filepath.Join(work, "all.jpg")
	if _, err := p.run(ctx, p.ffmpeg, joinArgs(work, count, sprite)...); err != nil {
		return fmt.Errorf("previews of video %d: %w", videoID, err)
	}
	if info, err := os.Stat(sprite); err != nil || info.Size() == 0 {
		return errors.Join(fmt.Errorf("previews of video %d: ffmpeg wrote no image", videoID), err)
	}

	// Put in place and saved only if the content is still the one we used.
	name := content.Stored(code, content.FileTimeline, previewVersion())
	same, err := content.IfSame(ctx, p.db, videoID, fingerprint, func(tx *sql.Tx) error {
		if err := p.root.Put(code, content.FileTimeline, sprite); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE videos
			SET preview = ?, preview_gap = ?, preview_count = ?, preview_width = ?, preview_height = ?
			WHERE id = ?`,
			name, gap, count, video.PreviewWidth, video.PreviewHeight, videoID)
		return err
	})
	if err != nil {
		return fmt.Errorf("save previews of video %d: %w", videoID, err)
	}
	if !same {
		return nil // the file changed meanwhile: these previews belong to nobody
	}
	return errors.Join(p.root.RemoveNotKept(old.String, name, p.root.Previews()),
		content.SaveManifest(ctx, p.db, p.root, videoID))
}

// previewVersion is the version of the previews in their address: it changes
// with the size of the frames. The browser keeps these images for a year, so
// an image made again at a new size needs a new address, or the player would
// cut the old one wrong. The "t" after the width says the frames are the real
// ones of their moment, as in the names of the old flat folder.
func previewVersion() string {
	return "w" + strconv.Itoa(video.PreviewWidth) + "t"
}

// frameCount is how many frames a video of duration seconds has, one
// every gap seconds from the start: 18 seconds every 2 make 9 (0, 2… 16).
func frameCount(duration, gap int64) int {
	if gap <= 0 || duration <= 0 {
		return 0
	}
	return int(min(int64(video.MaxPreviewFrames), (duration+gap-1)/gap))
}

// frames writes the single frames in work, 001.jpg for second 0, 002.jpg
// for second gap…, and counts them.
//
// ffmpeg runs once per frame and jumps to its second (-ss before -i):
// it starts from the key frame before it and decodes up to the exact
// picture, so each frame is the real one of its moment, even in videos
// with a key frame every ten seconds or only one. Reading key frames
// only, as before, was quicker, but showed the same picture several
// times and missed the end of short videos. A video that ends before its
// stated duration has fewer frames: the first second with no picture
// ends the list.
func (p *Previewer) frames(ctx context.Context, file string, duration, gap int64, work string) (int, error) {
	want := frameCount(duration, gap)
	for i := range want {
		second := int64(i) * gap
		out := filepath.Join(work, fmt.Sprintf(frameName, i+1))
		_, err := p.run(ctx, p.ffmpeg, frameArgs(file, second, out)...)
		if info, statErr := os.Stat(out); statErr == nil && info.Size() > 0 {
			jobs.Report(ctx, jobs.Progress{Percent: float64(i+1) * 100 / float64(want),
				Done: float64(second), Total: float64(duration)})
			continue
		}
		if ctx.Err() != nil {
			return 0, ctx.Err()
		}
		if i == 0 {
			if err == nil {
				err = errors.New("ffmpeg wrote no image")
			}
			return 0, err
		}
		return i, nil // the video ends here
	}
	return want, nil
}

// frameName is the pattern of the single frames: 001.jpg, 002.jpg…
const frameName = "%03d.jpg"

// frameArgs builds the ffmpeg command for one frame: the picture at
// second, shrunk to the preview size with black bars when the shape
// differs.
func frameArgs(file string, second int64, out string) []string {
	w, h := strconv.Itoa(video.PreviewWidth), strconv.Itoa(video.PreviewHeight)
	return []string{"-v", "error", "-y",
		"-ss", strconv.FormatInt(second, 10), "-i", "file:" + file,
		"-an", "-sn", "-dn",
		"-vf", "scale=" + w + ":" + h + ":force_original_aspect_ratio=decrease" +
			",pad=" + w + ":" + h + ":(ow-iw)/2:(oh-ih)/2",
		"-frames:v", "1", "-update", "1",
		"-q:v", "5",
		"-f", "image2", "file:" + out,
	}
}

// joinArgs builds the second ffmpeg command: the frames in one grid image.
func joinArgs(work string, count int, out string) []string {
	columns, rows := video.PreviewGrid(count)
	return []string{
		"-v", "error", "-y",
		"-f", "image2", "-i", filepath.Join(work, frameName),
		"-vf", "tile=" + strconv.Itoa(columns) + "x" + strconv.Itoa(rows),
		"-frames:v", "1",
		"-q:v", "5",
		"-f", "image2", "file:" + out,
	}
}

// RemoveOrphanPreviews deletes the files in the previews folder that no
// video uses any more, and work left half done. Like RemoveOrphanCovers,
// it must run before the job worker starts.
func RemoveOrphanPreviews(ctx context.Context, db *sql.DB, root content.Root) (removed int, err error) {
	return removeOrphans(ctx, db, root.Previews(), "videos", "preview")
}
