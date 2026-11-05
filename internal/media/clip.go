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

	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// ownClipSeconds is the most of an uploaded video kept in its clip.
const ownClipSeconds = 15

// clipFPS is the frames per second of every clip: smooth enough for a
// card, and lighter than the 30 or 60 of the videos.
const clipFPS = 24

// Clipper makes the clips with ffmpeg.
type Clipper struct {
	db      *sql.DB
	ffmpeg  string // program to run
	root    content.Root
	threads int // how many processor cores ffmpeg may use
	run     runFunc
}

// NewClipper returns a clipper that runs the given ffmpeg program and
// writes clips in the folder of each video, in root. Like conversions, it leaves half of the
// processor free, so the site stays quick on a Raspberry Pi.
func NewClipper(db *sql.DB, ffmpeg string, root content.Root) *Clipper {
	return &Clipper{db: db, ffmpeg: ffmpeg, root: root, threads: max(1, runtime.NumCPU()/2), run: runInBackground}
}

// Handle is the job handler for jobs.Clip. One run of ffmpeg makes both
// clips, the light one and the sharp one: the video is read only once.
func (c *Clipper) Handle(ctx context.Context, videoID int64) (err error) {
	file, fingerprint, err := locate(ctx, c.db, videoID)
	if err != nil {
		return err
	}
	var duration, second, seconds sql.NullInt64
	var old, oldHD, own sql.NullString
	var noClip bool
	if err := c.db.QueryRowContext(ctx, `SELECT duration, clip, clip_hd, own_clip, no_clip, clip_second, clip_seconds
		FROM videos WHERE id = ?`, videoID).
		Scan(&duration, &old, &oldHD, &own, &noClip, &second, &seconds); err != nil {
		return fmt.Errorf("read video %d: %w", videoID, err)
	}
	flat, flatHD := c.root.Clips(), c.root.ClipsHD()
	if noClip {
		// The administrator does not want a clip on this video.
		if _, err := c.db.ExecContext(ctx, `UPDATE videos SET clip = NULL, clip_hd = NULL WHERE id = ?`, videoID); err != nil {
			return fmt.Errorf("remove clip of video %d: %w", videoID, err)
		}
		return errors.Join(c.root.RemoveNotKept(old.String, "", flat), c.root.RemoveNotKept(oldHD.String, "", flatHD))
	}
	code, err := content.EnsureVideoFolder(ctx, c.db, c.root, videoID, fingerprint)
	if err != nil {
		return err
	}
	work, err := c.root.MakeWork()
	if err != nil {
		return err
	}
	version := ""
	var build func(ctx context.Context, out, outHD string) error
	if own.Valid {
		uploaded := c.root.File(own.String, c.root.OwnClips())
		version = "o" + ownTag(own.String)
		if v := content.Version(own.String); v != "" {
			version = "o" + v
		}
		build = func(ctx context.Context, out, outHD string) error {
			_, err := c.run(ctx, c.ffmpeg, ownClipArgs(uploaded, c.threads, out, outHD)...)
			return err
		}
	} else {
		site, err := ReadClipSettings(ctx, c.db)
		if err != nil {
			return err
		}
		plan := clipPlan(site, second, seconds)
		parts := plan.Parts(duration.Int64)
		if len(parts) == 0 {
			return nil // too short to need a clip
		}
		version = plan.Tag()
		build = func(ctx context.Context, out, outHD string) error {
			return c.fromParts(ctx, file, parts, work, out, outHD)
		}
	}

	// Rule 6: ffmpeg writes temporary files, renamed only when finished.
	tmp, err := newTemp(work)
	if err != nil {
		return fmt.Errorf("clip of video %d: %w", videoID, err)
	}
	defer func() { err = errors.Join(err, removeFile(work, filepath.Base(tmp))) }()
	tmpHD, err := newTemp(work)
	if err != nil {
		return fmt.Errorf("clip of video %d: %w", videoID, err)
	}
	defer func() { err = errors.Join(err, removeFile(work, filepath.Base(tmpHD))) }()

	if err := build(ctx, tmp, tmpHD); err != nil {
		return fmt.Errorf("clip of video %d: %w", videoID, err)
	}
	for _, made := range []string{tmp, tmpHD} {
		if info, err := os.Stat(made); err != nil || info.Size() == 0 {
			return errors.Join(fmt.Errorf("clip of video %d: ffmpeg wrote nothing", videoID), err)
		}
	}

	// Put in place and saved only if the content is still the one we used. The
	// sharp clip first: until the database names it, nobody asks for it.
	name := content.Stored(code, content.FileClip, version)
	nameHD := content.Stored(code, content.FileClipHD, version)
	same, err := content.IfSame(ctx, c.db, videoID, fingerprint, func(tx *sql.Tx) error {
		if err := c.root.Put(code, content.FileClipHD, tmpHD); err != nil {
			return err
		}
		if err := c.root.Put(code, content.FileClip, tmp); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE videos SET clip = ?, clip_hd = ? WHERE id = ?`, name, nameHD, videoID)
		return err
	})
	if err != nil {
		return fmt.Errorf("save clip of video %d: %w", videoID, err)
	}
	if !same {
		return nil // the file changed meanwhile: these clips belong to nobody
	}
	return errors.Join(c.root.RemoveNotKept(old.String, name, flat), c.root.RemoveNotKept(oldHD.String, nameHD, flatHD))
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

// fromParts makes the clips from the moments of the video, one moment at
// a time: each is read straight from its place (-ss before -i jumps there
// without decoding what comes before), made the same size, and written to
// a work folder in dir; a last run joins them. Opened all together, the
// moments of a 4K film needed 1.3 GB of memory, too much for a Raspberry
// Pi with 2 GB; one at a time, about 0.46 GB, and no slower.
func (c *Clipper) fromParts(ctx context.Context, file string, parts []video.ClipPart, dir, out, outHD string) (err error) {
	work, err := os.MkdirTemp(dir, ".new-*")
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, os.RemoveAll(work)) }()
	pieces := make([]string, len(parts))
	for i, p := range parts {
		pieces[i] = filepath.Join(work, strconv.Itoa(i)+".mp4")
		if _, err := c.run(ctx, c.ffmpeg, partArgs(file, p, c.threads, pieces[i])...); err != nil {
			return err
		}
	}
	_, err = c.run(ctx, c.ffmpeg, joinPartsArgs(pieces, c.threads, out, outHD)...)
	return err
}

// partArgs builds the ffmpeg command for one moment of the clip. The
// piece is only a step: it is made fast and nearly lossless (crf
// pieceQuality), so the clips lose nothing when it is encoded again.
func partArgs(file string, p video.ClipPart, threads int, out string) []string {
	return []string{"-v", "error", "-y",
		"-ss", strconv.FormatInt(p.Start, 10), "-t", strconv.FormatInt(p.Length, 10),
		"-i", "file:" + file,
		"-map", "0:v:0", "-an", "-sn", "-dn",
		"-vf", clipFrames,
		"-c:v", "libx264", "-preset", "ultrafast", "-crf", strconv.Itoa(pieceQuality),
		"-threads", strconv.Itoa(threads),
		"-f", "mp4", "file:" + out,
	}
}

// pieceQuality is the quality of the moments before they are joined: low
// numbers are sharper, and 16 cannot be told from the original.
const pieceQuality = 16

// joinPartsArgs builds the ffmpeg command that joins the moments one after
// the other and writes the two clips. No sound: the clip plays silent on
// the card.
func joinPartsArgs(pieces []string, threads int, out, outHD string) []string {
	args := []string{"-v", "error", "-y"}
	var joined strings.Builder
	for i, p := range pieces {
		args = append(args, "-i", "file:"+p)
		fmt.Fprintf(&joined, "[%d:v:0]", i)
	}
	filter := fmt.Sprintf("%sconcat=n=%d:v=1:a=0[clip];%s", joined.String(), len(pieces), twoSizes)
	args = append(args, "-filter_complex", filter)
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
func RemoveOrphanOwnClips(ctx context.Context, db *sql.DB, root content.Root) (removed int, err error) {
	return removeOrphans(ctx, db, root.OwnClips(), "videos", "own_clip")
}

// RemoveOrphanClips deletes the files in the two clips folders that no
// video uses any more, and work left half done. Like RemoveOrphanCovers, it must
// run before the job worker starts.
func RemoveOrphanClips(ctx context.Context, db *sql.DB, root content.Root) (removed int, err error) {
	removed, err = removeOrphans(ctx, db, root.Clips(), "videos", "clip")
	if err != nil {
		return removed, err
	}
	hd, err := removeOrphans(ctx, db, root.ClipsHD(), "videos", "clip_hd")
	return removed + hd, err
}
