package media

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/safefile"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// PreviewsDir is the folder, inside the data folder, that holds the
// previews shown over the player's timeline.
const PreviewsDir = "previews"

// Previewer makes the previews with ffmpeg.
type Previewer struct {
	db      *sql.DB
	ffmpeg  string // program to run
	dataDir string
	run     runFunc
}

// NewPreviewer returns a previewer that runs the given ffmpeg program and
// writes previews in dataDir/previews.
func NewPreviewer(db *sql.DB, ffmpeg, dataDir string) *Previewer {
	return &Previewer{db: db, ffmpeg: ffmpeg, dataDir: dataDir, run: runInBackground}
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

	dir := filepath.Join(p.dataDir, PreviewsDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("create previews folder: %w", err)
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

	name := previewName(videoID, fingerprint)
	if err := safefile.Rename(sprite, filepath.Join(dir, name)); err != nil {
		return fmt.Errorf("previews of video %d: %w", videoID, err)
	}
	res, err := p.db.ExecContext(ctx, `UPDATE videos
		SET preview = ?, preview_gap = ?, preview_count = ?, preview_width = ?, preview_height = ?
		WHERE id = ? AND fingerprint = ?`,
		name, gap, count, video.PreviewWidth, video.PreviewHeight, videoID, fingerprint)
	if err != nil {
		return fmt.Errorf("save previews of video %d: %w", videoID, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("save previews of video %d: %w", videoID, err)
	}
	if n == 0 {
		// The file changed meanwhile: these previews belong to nobody.
		return removeFile(dir, name)
	}
	if old.Valid && old.String != name {
		return removeFile(dir, old.String)
	}
	return nil
}

// previewName is the file name of the previews of a video: like its cover,
// it changes with the content, and also with the size of the frames. The
// browser keeps these images for a year, so an image made again at a new
// size needs a new name, or the player would cut the old one wrong.
// The "t" after the width says the frames are the real ones of their
// moment: the images made before, from key frames only, had other
// pictures under the name without it.
func previewName(videoID int64, fingerprint string) string {
	return strings.TrimSuffix(coverName(videoID, fingerprint), ".jpg") +
		"-w" + strconv.Itoa(video.PreviewWidth) + "t.jpg"
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
func RemoveOrphanPreviews(ctx context.Context, db *sql.DB, dataDir string) (removed int, err error) {
	return removeOrphans(ctx, db, filepath.Join(dataDir, PreviewsDir), "videos", "preview")
}
