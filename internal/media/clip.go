package media

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/FranzGra/FranzPLAY/internal/video"
)

// ClipsDir is the folder, inside the data folder, that holds the clips
// that play on a video's card when the pointer rests on it.
const ClipsDir = "clips"

// clipFPS is the frames per second of every clip: smooth enough for a
// card, and lighter than the 30 or 60 of the videos.
const clipFPS = 24

// Clipper makes the clips with ffmpeg.
type Clipper struct {
	db      *sql.DB
	ffmpeg  string // program to run
	dataDir string
	threads int // how many processor cores ffmpeg may use
	run     runFunc
}

// NewClipper returns a clipper that runs the given ffmpeg program and
// writes clips in dataDir/clips. Like conversions, it leaves half of the
// processor free, so the site stays quick on a Raspberry Pi.
func NewClipper(db *sql.DB, ffmpeg, dataDir string) *Clipper {
	return &Clipper{db: db, ffmpeg: ffmpeg, dataDir: dataDir, threads: max(1, runtime.NumCPU()/2), run: runInBackground}
}

// Handle is the job handler for jobs.Clip.
func (c *Clipper) Handle(ctx context.Context, videoID int64) (err error) {
	file, fingerprint, err := locate(ctx, c.db, videoID)
	if err != nil {
		return err
	}
	var duration sql.NullInt64
	var old sql.NullString
	if err := c.db.QueryRowContext(ctx, `SELECT duration, clip FROM videos WHERE id = ?`, videoID).
		Scan(&duration, &old); err != nil {
		return fmt.Errorf("read video %d: %w", videoID, err)
	}
	parts := video.ClipParts(duration.Int64)
	if len(parts) == 0 {
		return nil // too short to need a clip
	}

	dir := filepath.Join(c.dataDir, ClipsDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("create clips folder: %w", err)
	}
	// Rule 6: ffmpeg writes a temporary file, renamed only when finished.
	tmp, err := os.CreateTemp(dir, ".new-*.mp4")
	if err != nil {
		return fmt.Errorf("clip of video %d: %w", videoID, err)
	}
	tmpName := tmp.Name()
	if err := tmp.Close(); err != nil {
		return errors.Join(fmt.Errorf("clip of video %d: %w", videoID, err), os.Remove(tmpName))
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, removeFile(dir, filepath.Base(tmpName)))
		}
	}()

	if _, err := c.run(ctx, c.ffmpeg, clipArgs(file, parts, c.threads, tmpName)...); err != nil {
		return fmt.Errorf("clip of video %d: %w", videoID, err)
	}
	if info, err := os.Stat(tmpName); err != nil || info.Size() == 0 {
		return errors.Join(fmt.Errorf("clip of video %d: ffmpeg wrote nothing", videoID), err)
	}

	name := clipName(videoID, fingerprint)
	if err := os.Rename(tmpName, filepath.Join(dir, name)); err != nil {
		return fmt.Errorf("clip of video %d: %w", videoID, err)
	}
	res, err := c.db.ExecContext(ctx, `UPDATE videos SET clip = ? WHERE id = ? AND fingerprint = ?`,
		name, videoID, fingerprint)
	if err != nil {
		return fmt.Errorf("save clip of video %d: %w", videoID, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("save clip of video %d: %w", videoID, err)
	}
	if n == 0 {
		// The file changed meanwhile: this clip belongs to nobody.
		return removeFile(dir, name)
	}
	if old.Valid && old.String != name {
		return removeFile(dir, old.String)
	}
	return nil
}

// clipName is the clip file of a video. Like the cover's, it changes when
// the content changes, so a browser never plays the clip of the old file.
func clipName(videoID int64, fingerprint string) string {
	return strings.TrimSuffix(coverName(videoID, fingerprint), ".jpg") + ".mp4"
}

// clipArgs builds the ffmpeg command for a clip: each part is read
// straight from its moment (-ss before -i jumps there without decoding
// what comes before), made the same small size, and the parts are joined
// one after the other. No sound: the clip plays silent on the card.
func clipArgs(file string, parts []video.ClipPart, threads int, out string) []string {
	args := []string{"-v", "error", "-y"}
	var filter, joined strings.Builder
	for i, p := range parts {
		args = append(args,
			"-ss", strconv.FormatInt(p.Start, 10), "-t", strconv.FormatInt(p.Length, 10),
			"-i", "file:"+file)
		label := "p" + strconv.Itoa(i)
		fmt.Fprintf(&filter, "[%d:v:0]fps=%d,scale=-2:%d,setsar=1,format=yuv420p[%s];",
			i, clipFPS, video.ClipHeight, label)
		joined.WriteString("[" + label + "]")
	}
	fmt.Fprintf(&filter, "%sconcat=n=%d:v=1:a=0[clip]", joined.String(), len(parts))
	return append(args,
		"-filter_complex", filter.String(),
		"-map", "[clip]",
		"-an", "-sn", "-dn",
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
		"-threads", strconv.Itoa(threads),
		// The index goes at the start, so the browser plays it at once.
		"-movflags", "+faststart",
		"-f", "mp4", "file:"+out,
	)
}

// RemoveOrphanClips deletes the files in the clips folder that no video
// uses any more, and work left half done. Like RemoveOrphanCovers, it must
// run before the job worker starts.
func RemoveOrphanClips(ctx context.Context, db *sql.DB, dataDir string) (removed int, err error) {
	return removeOrphans(ctx, db, filepath.Join(dataDir, ClipsDir), "videos", "clip")
}
