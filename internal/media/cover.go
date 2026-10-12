package media

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// CoversDir is the folder, inside the data folder, that holds the covers.
const CoversDir = "covers"

// coverWidth is the width of every cover. 640 pixels look sharp on a phone
// and in the grid on a computer, and weigh about 30-60 KB.
const coverWidth = 640

// sidecarImages are the images, next to a video and with its name, that
// are used as its cover instead of a frame of the video. For "mare.mp4"
// that is "mare.jpg", "mare-poster.jpg" and so on, in this order. yt-dlp
// saves covers this way with --write-thumbnail.
var sidecarImages = []string{
	".jpg", ".jpeg", ".png", ".webp",
	"-poster.jpg", "-poster.png", "-thumb.jpg", "-thumb.png",
}

// coverSecond picks the moment of the video used as cover: one tenth in,
// so it is past black openings and titles, but at most one minute in.
// Very short or unknown durations use the first frame.
func coverSecond(duration int64) int64 {
	if duration < 2 {
		return 0
	}
	return min(max(duration/10, 1), 60)
}

// coverName is the cover file of a video. It changes when the content
// changes, so a browser never shows the cover of the old file.
func coverName(videoID int64, fingerprint string) string {
	tail := fingerprint[max(0, len(fingerprint)-8):]
	return strconv.FormatInt(videoID, 10) + "-" + tail + ".jpg"
}

// Coverer makes the covers with ffmpeg.
type Coverer struct {
	db      *sql.DB
	ffmpeg  string // program to run
	dataDir string
	run     runFunc
}

// NewCoverer returns a coverer that runs the given ffmpeg program and
// writes covers in dataDir/covers.
func NewCoverer(db *sql.DB, ffmpeg, dataDir string) *Coverer {
	return &Coverer{db: db, ffmpeg: ffmpeg, dataDir: dataDir, run: run}
}

// Handle is the job handler for jobs.Cover.
func (c *Coverer) Handle(ctx context.Context, videoID int64) (err error) {
	file, fingerprint, err := locate(ctx, c.db, videoID)
	if err != nil {
		return err
	}
	var duration sql.NullInt64
	var oldCover sql.NullString
	if err := c.db.QueryRowContext(ctx, `SELECT duration, cover FROM videos WHERE id = ?`, videoID).
		Scan(&duration, &oldCover); err != nil {
		return fmt.Errorf("read video %d: %w", videoID, err)
	}

	dir := filepath.Join(c.dataDir, CoversDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("create covers folder: %w", err)
	}

	// Rule 6: ffmpeg writes a temporary file, renamed only when complete.
	tmp, err := os.CreateTemp(dir, ".new-*.jpg")
	if err != nil {
		return fmt.Errorf("cover of video %d: %w", videoID, err)
	}
	tmpName := tmp.Name()
	if err := tmp.Close(); err != nil {
		return errors.Join(fmt.Errorf("cover of video %d: %w", videoID, err), os.Remove(tmpName))
	}
	defer func() {
		// Left over only when something failed; after success it was renamed.
		if rmErr := os.Remove(tmpName); rmErr != nil && !errors.Is(rmErr, fs.ErrNotExist) {
			err = errors.Join(err, rmErr)
		}
	}()

	args := c.coverArgs(file, duration.Int64, tmpName)
	if _, err := c.run(ctx, c.ffmpeg, args...); err != nil {
		return fmt.Errorf("cover of video %d: %w", videoID, err)
	}
	info, err := os.Stat(tmpName)
	if err != nil {
		return fmt.Errorf("cover of video %d: %w", videoID, err)
	}
	if info.Size() == 0 {
		return fmt.Errorf("cover of video %d: ffmpeg wrote no image", videoID)
	}

	name := coverName(videoID, fingerprint)
	if err := os.Rename(tmpName, filepath.Join(dir, name)); err != nil {
		return fmt.Errorf("cover of video %d: %w", videoID, err)
	}

	// Saved only if the content is still the one we used.
	res, err := c.db.ExecContext(ctx, `UPDATE videos SET cover = ? WHERE id = ? AND fingerprint = ?`,
		name, videoID, fingerprint)
	if err != nil {
		return fmt.Errorf("save cover of video %d: %w", videoID, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("save cover of video %d: %w", videoID, err)
	}
	if n == 0 {
		// The file changed meanwhile: this cover belongs to nobody.
		return removeCover(dir, name)
	}
	if oldCover.Valid && oldCover.String != name {
		return removeCover(dir, oldCover.String)
	}
	return nil
}

// coverArgs builds the ffmpeg command: from an image next to the video if
// there is one, otherwise from a frame of the video. Both end as a JPEG
// coverWidth wide (or smaller, never enlarged).
func (c *Coverer) coverArgs(video string, duration int64, out string) []string {
	args := []string{"-v", "error", "-y"}
	if image, ok := findSidecar(video); ok {
		args = append(args, "-i", "file:"+image)
	} else {
		// -ss before -i jumps straight to the moment instead of decoding up to it.
		args = append(args, "-ss", strconv.FormatInt(coverSecond(duration), 10), "-i", "file:"+video)
	}
	return append(args,
		"-frames:v", "1",
		"-vf", "scale='min("+strconv.Itoa(coverWidth)+",iw)':-2",
		"-q:v", "3",
		"-f", "image2", "file:"+out)
}

// findSidecar looks for an image next to the video, with the same name.
// It only checks whether files exist: nothing is written there.
func findSidecar(video string) (string, bool) {
	base := strings.TrimSuffix(video, filepath.Ext(video))
	for _, suffix := range sidecarImages {
		candidate := base + suffix
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() {
			return candidate, true
		}
	}
	return "", false
}

// removeCover deletes a cover file. A file already gone is fine.
func removeCover(dir, name string) error {
	if err := os.Remove(filepath.Join(dir, filepath.Base(name))); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("remove old cover: %w", err)
	}
	return nil
}

// RemoveOrphanCovers deletes the files in the covers folder that no video
// uses any more (videos forgotten after being missing for a long time).
// It only ever looks inside the covers folder of the data folder. It must
// run before the job worker starts, so it never sees a cover being made.
func RemoveOrphanCovers(ctx context.Context, db *sql.DB, dataDir string) (removed int, err error) {
	dir := filepath.Join(dataDir, CoversDir)
	entries, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("read covers folder: %w", err)
	}
	used, err := usedCovers(ctx, db)
	if err != nil {
		return 0, err
	}
	for _, e := range entries {
		if e.IsDir() || used[e.Name()] {
			continue
		}
		if err := removeCover(dir, e.Name()); err != nil {
			return removed, err
		}
		removed++
	}
	return removed, nil
}

func usedCovers(ctx context.Context, db *sql.DB) (_ map[string]bool, err error) {
	rows, err := db.QueryContext(ctx, `SELECT cover FROM videos WHERE cover IS NOT NULL`)
	if err != nil {
		return nil, fmt.Errorf("read covers: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	used := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("read covers: %w", err)
		}
		used[name] = true
	}
	return used, rows.Err()
}
