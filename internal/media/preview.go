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
	return &Previewer{db: db, ffmpeg: ffmpeg, dataDir: dataDir, run: run}
}

// Handle is the job handler for jobs.Preview. It works in two steps:
// ffmpeg writes one small frame every few seconds, then joins them in one
// image. Counting the frames in between says exactly how many there are,
// even when the video ends a little before its stated duration.
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

	count, err := p.frames(ctx, file, gap, work, true)
	if err == nil && count == 0 {
		// A video with a single key frame gives none that way: read every
		// frame instead. Such videos are short, so it is still quick.
		count, err = p.frames(ctx, file, gap, work, false)
	}
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

	name := coverName(videoID, fingerprint) // same naming: changes with the content
	if err := os.Rename(sprite, filepath.Join(dir, name)); err != nil {
		return fmt.Errorf("previews of video %d: %w", videoID, err)
	}
	res, err := p.db.ExecContext(ctx, `UPDATE videos SET preview = ?, preview_gap = ?, preview_count = ?
		WHERE id = ? AND fingerprint = ?`, name, gap, count, videoID, fingerprint)
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

// frames writes the single frames in work and counts them.
func (p *Previewer) frames(ctx context.Context, file string, gap int64, work string, keyOnly bool) (int, error) {
	if _, err := p.run(ctx, p.ffmpeg, framesArgs(file, gap, work, keyOnly)...); err != nil {
		return 0, err
	}
	return countFrames(work)
}

// frameName is the pattern of the single frames: 001.jpg, 002.jpg…
const frameName = "%03d.jpg"

// framesArgs builds the first ffmpeg command: one frame every gap seconds,
// shrunk to the preview size with black bars when the shape differs.
// With keyOnly only key frames are decoded (-skip_frame nokey): the
// previews are a little less exact, but even a Raspberry Pi makes them in
// seconds instead of watching the whole video.
func framesArgs(file string, gap int64, work string, keyOnly bool) []string {
	w, h := strconv.Itoa(video.PreviewWidth), strconv.Itoa(video.PreviewHeight)
	args := []string{"-v", "error", "-y"}
	if keyOnly {
		args = append(args, "-skip_frame", "nokey")
	}
	return append(args,
		"-i", "file:"+file,
		"-an", "-sn",
		"-vf", "fps=1/"+strconv.FormatInt(gap, 10)+
			",scale="+w+":"+h+":force_original_aspect_ratio=decrease"+
			",pad="+w+":"+h+":(ow-iw)/2:(oh-ih)/2",
		"-frames:v", strconv.Itoa(video.MaxPreviewFrames),
		"-q:v", "5",
		"-f", "image2", filepath.Join(work, frameName),
	)
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

// countFrames counts the single frames ffmpeg wrote.
func countFrames(work string) (int, error) {
	entries, err := os.ReadDir(work)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".jpg") {
			n++
		}
	}
	return n, nil
}

// RemoveOrphanPreviews deletes the files in the previews folder that no
// video uses any more, and work left half done. Like RemoveOrphanCovers,
// it must run before the job worker starts.
func RemoveOrphanPreviews(ctx context.Context, db *sql.DB, dataDir string) (removed int, err error) {
	return removeOrphans(ctx, db, filepath.Join(dataDir, PreviewsDir), "videos", "preview")
}
