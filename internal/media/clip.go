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

// ClipsHDDir is the folder, inside the data folder, that holds the same
// clips made sharper, for browsers on a good connection. Each has the
// same name as its light twin in ClipsDir.
const ClipsHDDir = "clips-hd"

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
	return &Clipper{db: db, ffmpeg: ffmpeg, dataDir: dataDir, threads: max(1, runtime.NumCPU()/2), run: runInBackground}
}

// Handle is the job handler for jobs.Clip. One run of ffmpeg makes both
// clips, the light one and the sharp one: the video is read only once.
func (c *Clipper) Handle(ctx context.Context, videoID int64) (err error) {
	file, fingerprint, err := locate(ctx, c.db, videoID)
	if err != nil {
		return err
	}
	var duration sql.NullInt64
	var old, oldHD, own sql.NullString
	var noClip bool
	if err := c.db.QueryRowContext(ctx, `SELECT duration, clip, clip_hd, own_clip, no_clip FROM videos WHERE id = ?`, videoID).
		Scan(&duration, &old, &oldHD, &own, &noClip); err != nil {
		return fmt.Errorf("read video %d: %w", videoID, err)
	}
	dir := filepath.Join(c.dataDir, ClipsDir)
	dirHD := filepath.Join(c.dataDir, ClipsHDDir)
	if noClip {
		// The administrator does not want a clip on this video.
		if _, err := c.db.ExecContext(ctx, `UPDATE videos SET clip = NULL, clip_hd = NULL WHERE id = ?`, videoID); err != nil {
			return fmt.Errorf("remove clip of video %d: %w", videoID, err)
		}
		return errors.Join(removeIfValid(dir, old), removeIfValid(dirHD, oldHD))
	}
	name := clipName(videoID, fingerprint)
	var args func(out, outHD string) []string
	if own.Valid {
		uploaded := filepath.Join(c.dataDir, OwnClipsDir, filepath.Base(own.String))
		name = strings.TrimSuffix(name, ".mp4") + "-o" + ownTag(own.String) + ".mp4"
		args = func(out, outHD string) []string { return ownClipArgs(uploaded, c.threads, out, outHD) }
	} else {
		parts := video.ClipParts(duration.Int64)
		if len(parts) == 0 {
			return nil // too short to need a clip
		}
		args = func(out, outHD string) []string { return clipArgs(file, parts, c.threads, out, outHD) }
	}

	// Rule 6: ffmpeg writes temporary files, renamed only when finished.
	tmp, err := newTemp(dir)
	if err != nil {
		return fmt.Errorf("clip of video %d: %w", videoID, err)
	}
	defer func() { err = errors.Join(err, removeFile(dir, filepath.Base(tmp))) }()
	tmpHD, err := newTemp(dirHD)
	if err != nil {
		return fmt.Errorf("clip of video %d: %w", videoID, err)
	}
	defer func() { err = errors.Join(err, removeFile(dirHD, filepath.Base(tmpHD))) }()

	if _, err := c.run(ctx, c.ffmpeg, args(tmp, tmpHD)...); err != nil {
		return fmt.Errorf("clip of video %d: %w", videoID, err)
	}
	for _, made := range []string{tmp, tmpHD} {
		if info, err := os.Stat(made); err != nil || info.Size() == 0 {
			return errors.Join(fmt.Errorf("clip of video %d: ffmpeg wrote nothing", videoID), err)
		}
	}

	// The sharp clip first: until the database names it, nobody asks for it.
	if err := os.Rename(tmpHD, filepath.Join(dirHD, name)); err != nil {
		return fmt.Errorf("clip of video %d: %w", videoID, err)
	}
	if err := os.Rename(tmp, filepath.Join(dir, name)); err != nil {
		return fmt.Errorf("clip of video %d: %w", videoID, err)
	}
	res, err := c.db.ExecContext(ctx, `UPDATE videos SET clip = ?, clip_hd = ? WHERE id = ? AND fingerprint = ?`,
		name, name, videoID, fingerprint)
	if err != nil {
		return fmt.Errorf("save clip of video %d: %w", videoID, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("save clip of video %d: %w", videoID, err)
	}
	if n == 0 {
		// The file changed meanwhile: these clips belong to nobody.
		return errors.Join(removeFile(dir, name), removeFile(dirHD, name))
	}
	if old.String == name {
		old.Valid = false
	}
	if oldHD.String == name {
		oldHD.Valid = false
	}
	return errors.Join(removeIfValid(dir, old), removeIfValid(dirHD, oldHD))
}

// newTemp creates dir if needed and an empty temporary clip in it, for
// ffmpeg to fill. Its name starts with ".new-", so a crash leaves
// nothing that RemoveOrphanClips would not clean.
func newTemp(dir string) (string, error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", fmt.Errorf("create clips folder: %w", err)
	}
	f, err := os.CreateTemp(dir, ".new-*.mp4")
	if err != nil {
		return "", err
	}
	name := f.Name()
	if err := f.Close(); err != nil {
		return "", errors.Join(err, os.Remove(name))
	}
	return name, nil
}

// removeIfValid removes the file name in dir, if there is a name.
func removeIfValid(dir string, name sql.NullString) error {
	if !name.Valid {
		return nil
	}
	return removeFile(dir, name.String)
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
// administrator into the two clips: its first ownClipSeconds, made like
// the others.
func ownClipArgs(uploaded string, threads int, out, outHD string) []string {
	args := []string{"-v", "error", "-y",
		"-t", strconv.Itoa(ownClipSeconds), "-i", "file:" + uploaded,
		"-filter_complex", "[0:v:0]" + clipFrames + "[clip];" + twoSizes,
	}
	return append(args, clipOutputs(threads, out, outHD)...)
}

// clipArgs builds the ffmpeg command for the clips: each part is read
// straight from its moment (-ss before -i jumps there without decoding
// what comes before), made the same size, and the parts are joined one
// after the other. No sound: the clip plays silent on the card.
func clipArgs(file string, parts []video.ClipPart, threads int, out, outHD string) []string {
	args := []string{"-v", "error", "-y"}
	var filter, joined strings.Builder
	for i, p := range parts {
		args = append(args,
			"-ss", strconv.FormatInt(p.Start, 10), "-t", strconv.FormatInt(p.Length, 10),
			"-i", "file:"+file)
		label := "p" + strconv.Itoa(i)
		fmt.Fprintf(&filter, "[%d:v:0]%s[%s];", i, clipFrames, label)
		joined.WriteString("[" + label + "]")
	}
	fmt.Fprintf(&filter, "%sconcat=n=%d:v=1:a=0[clip];%s", joined.String(), len(parts), twoSizes)
	args = append(args, "-filter_complex", filter.String())
	return append(args, clipOutputs(threads, out, outHD)...)
}

// clipFrames makes every part of a clip alike, so they can be joined:
// clipFPS frames a second, at most ClipHDHeight high (never enlarged, and
// an even number, which H.264 needs).
var clipFrames = fmt.Sprintf("fps=%d,scale=-2:'trunc(min(%d,ih)/2)*2',setsar=1,format=yuv420p",
	clipFPS, video.ClipHDHeight)

// twoSizes splits the joined clip in two: the sharp one as it is, and the
// light one made ClipHeight high.
var twoSizes = fmt.Sprintf("[clip]split=2[hd][small];[small]scale=-2:%d,setsar=1[sd]", video.ClipHeight)

// clipOutputs writes the two clips: silent H.264 MP4 files with their
// index at the start, so the browser plays them at once.
func clipOutputs(threads int, out, outHD string) []string {
	var args []string
	for _, o := range []struct{ label, file string }{{"[sd]", out}, {"[hd]", outHD}} {
		args = append(args,
			"-map", o.label,
			"-an", "-sn", "-dn",
			"-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
			"-threads", strconv.Itoa(threads),
			"-movflags", "+faststart",
			"-f", "mp4", "file:"+o.file,
		)
	}
	return args
}

// RemoveOrphanOwnClips deletes the videos uploaded as clips that no video
// uses any more. Like RemoveOrphanCovers, it must run before the job
// worker and the web server start.
func RemoveOrphanOwnClips(ctx context.Context, db *sql.DB, dataDir string) (removed int, err error) {
	return removeOrphans(ctx, db, filepath.Join(dataDir, OwnClipsDir), "videos", "own_clip")
}

// RemoveOrphanClips deletes the files in the two clips folders that no
// video uses any more, and work left half done. Like RemoveOrphanCovers, it must
// run before the job worker starts.
func RemoveOrphanClips(ctx context.Context, db *sql.DB, dataDir string) (removed int, err error) {
	removed, err = removeOrphans(ctx, db, filepath.Join(dataDir, ClipsDir), "videos", "clip")
	if err != nil {
		return removed, err
	}
	hd, err := removeOrphans(ctx, db, filepath.Join(dataDir, ClipsHDDir), "videos", "clip_hd")
	return removed + hd, err
}
