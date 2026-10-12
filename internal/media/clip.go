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

// OwnClipsDir is the folder, inside the data folder, that holds the
// videos the administrator uploaded as clips, as they were sent. The clip
// job turns them into clips like the others: small, silent, quick to load.
const OwnClipsDir = "own-clips"

// ownClipSeconds is the most of an uploaded video kept in its clip.
const ownClipSeconds = 15

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
	return &Clipper{db: db, ffmpeg: ffmpeg, dataDir: dataDir, threads: max(1, runtime.NumCPU()/2), run: run}
}

// Handle is the job handler for jobs.Clip.
func (c *Clipper) Handle(ctx context.Context, videoID int64) (err error) {
	file, fingerprint, err := locate(ctx, c.db, videoID)
	if err != nil {
		return err
	}
	var duration sql.NullInt64
	var old, own sql.NullString
	var noClip bool
	if err := c.db.QueryRowContext(ctx, `SELECT duration, clip, own_clip, no_clip FROM videos WHERE id = ?`, videoID).
		Scan(&duration, &old, &own, &noClip); err != nil {
		return fmt.Errorf("read video %d: %w", videoID, err)
	}
	dir := filepath.Join(c.dataDir, ClipsDir)
	if noClip {
		// The administrator does not want a clip on this video.
		if _, err := c.db.ExecContext(ctx, `UPDATE videos SET clip = NULL WHERE id = ?`, videoID); err != nil {
			return fmt.Errorf("remove clip of video %d: %w", videoID, err)
		}
		if old.Valid {
			return removeFile(dir, old.String)
		}
		return nil
	}
	name := clipName(videoID, fingerprint)
	var args func(out string) []string
	if own.Valid {
		uploaded := filepath.Join(c.dataDir, OwnClipsDir, filepath.Base(own.String))
		name = strings.TrimSuffix(name, ".mp4") + "-o" + ownTag(own.String) + ".mp4"
		args = func(out string) []string { return ownClipArgs(uploaded, c.threads, out) }
	} else {
		parts := video.ClipParts(duration.Int64)
		if len(parts) == 0 {
			return nil // too short to need a clip
		}
		args = func(out string) []string { return clipArgs(file, parts, c.threads, out) }
	}

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

	if _, err := c.run(ctx, c.ffmpeg, args(tmpName)...); err != nil {
		return fmt.Errorf("clip of video %d: %w", videoID, err)
	}
	if info, err := os.Stat(tmpName); err != nil || info.Size() == 0 {
		return errors.Join(fmt.Errorf("clip of video %d: ffmpeg wrote nothing", videoID), err)
	}

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

// ownTag is a short piece of an uploaded file's name, which is new at
// every upload: the clip's name changes with it, so browsers never play
// the old one.
func ownTag(uploaded string) string {
	base := strings.TrimSuffix(filepath.Base(uploaded), filepath.Ext(uploaded))
	return base[max(0, len(base)-8):]
}

// ownClipArgs builds the ffmpeg command that turns a video uploaded by the
// administrator into a clip: its first ownClipSeconds, made like the
// others.
func ownClipArgs(uploaded string, threads int, out string) []string {
	return []string{"-v", "error", "-y",
		"-t", strconv.Itoa(ownClipSeconds), "-i", "file:" + uploaded,
		"-map", "0:v:0",
		"-vf", fmt.Sprintf("fps=%d,scale=-2:%d,setsar=1,format=yuv420p", clipFPS, video.ClipHeight),
		"-an", "-sn", "-dn",
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
		"-threads", strconv.Itoa(threads),
		"-movflags", "+faststart",
		"-f", "mp4", "file:" + out,
	}
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

// RemoveOrphanOwnClips deletes the videos uploaded as clips that no video
// uses any more. Like RemoveOrphanCovers, it must run before the job
// worker and the web server start.
func RemoveOrphanOwnClips(ctx context.Context, db *sql.DB, dataDir string) (removed int, err error) {
	return removeOrphans(ctx, db, filepath.Join(dataDir, OwnClipsDir), "videos", "own_clip")
}

// RemoveOrphanClips deletes the files in the clips folder that no video
// uses any more, and work left half done. Like RemoveOrphanCovers, it must
// run before the job worker starts.
func RemoveOrphanClips(ctx context.Context, db *sql.DB, dataDir string) (removed int, err error) {
	return removeOrphans(ctx, db, filepath.Join(dataDir, ClipsDir), "videos", "clip")
}
