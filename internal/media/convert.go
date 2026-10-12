package media

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/FranzGra/FranzPLAY/internal/video"
)

// ConvertedDir is the folder, inside the data folder, that holds the
// copies of the videos that not every browser plays.
const ConvertedDir = "converted"

// convertedName is the copy of a video. Like the cover's, it changes when
// the content changes.
func convertedName(videoID int64, fingerprint string) string {
	return strings.TrimSuffix(coverName(videoID, fingerprint), ".jpg") + ".mp4"
}

// Converter makes, with ffmpeg, a copy of the videos that not every
// browser plays: an MP4 with H.264 picture and the sound tracks the
// browsers know. The video file itself is only read (rule 1).
type Converter struct {
	db      *sql.DB
	ffmpeg  string // program to run
	dataDir string
	threads int // how many processor cores ffmpeg may use
	run     runFunc
}

// NewConverter returns a converter that runs the given ffmpeg program and
// writes in dataDir/converted. ffmpeg uses half the processor cores, so
// the site stays quick while a film is being encoded.
func NewConverter(db *sql.DB, ffmpeg, dataDir string) *Converter {
	return &Converter{db: db, ffmpeg: ffmpeg, dataDir: dataDir, threads: max(1, runtime.NumCPU()/2), run: run}
}

// Handle is the job handler for jobs.Convert. For a video that plays as it
// is, it only forgets an old copy, if any.
func (c *Converter) Handle(ctx context.Context, videoID int64) (err error) {
	file, fingerprint, err := locate(ctx, c.db, videoID)
	if err != nil {
		return err
	}
	var videoCodec, audioCodec, old sql.NullString
	if err := c.db.QueryRowContext(ctx, `SELECT video_codec, audio_codec, converted FROM videos WHERE id = ?`,
		videoID).Scan(&videoCodec, &audioCodec, &old); err != nil {
		return fmt.Errorf("read video %d: %w", videoID, err)
	}
	if !videoCodec.Valid {
		return fmt.Errorf("convert video %d: not read by ffprobe yet", videoID)
	}
	plan := video.PlanConversion(filepath.Ext(file), video.Info{VideoCodec: videoCodec.String, AudioCodec: audioCodec.String})
	dir := filepath.Join(c.dataDir, ConvertedDir)
	name := ""
	if plan.Needed {
		name = convertedName(videoID, fingerprint)
	}
	if old.Valid && old.String == name {
		if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
			return nil // already made, for this very content
		}
	}
	if plan.Needed {
		if err := c.convert(ctx, videoID, file, plan, dir, name); err != nil {
			return err
		}
	}

	// Saved only if the content is still the one we used.
	var saved any // NULL: no copy needed
	if name != "" {
		saved = name
	}
	res, err := c.db.ExecContext(ctx, `UPDATE videos SET converted = ? WHERE id = ? AND fingerprint = ?`,
		saved, videoID, fingerprint)
	if err != nil {
		return fmt.Errorf("save copy of video %d: %w", videoID, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("save copy of video %d: %w", videoID, err)
	}
	if n == 0 {
		// The file changed meanwhile: this copy belongs to nobody.
		if name == "" {
			return nil
		}
		return removeFile(dir, name)
	}
	if old.Valid && old.String != name {
		return removeFile(dir, old.String)
	}
	return nil
}

// convert runs ffmpeg into a temporary file, renamed to name only when
// complete (rule 6).
func (c *Converter) convert(ctx context.Context, videoID int64, file string, plan video.ConvertPlan, dir, name string) (err error) {
	sounds, err := c.soundCodecs(ctx, videoID)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("create converted folder: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".new-*.mp4")
	if err != nil {
		return fmt.Errorf("convert video %d: %w", videoID, err)
	}
	tmpName := tmp.Name()
	if err := tmp.Close(); err != nil {
		return errors.Join(fmt.Errorf("convert video %d: %w", videoID, err), os.Remove(tmpName))
	}
	defer func() {
		// Left over only when something failed; after success it was renamed.
		if rmErr := os.Remove(tmpName); rmErr != nil && !errors.Is(rmErr, fs.ErrNotExist) {
			err = errors.Join(err, rmErr)
		}
	}()

	if _, err := c.run(ctx, c.ffmpeg, convertArgs(file, plan, sounds, c.threads, tmpName)...); err != nil {
		return fmt.Errorf("convert video %d: %w", videoID, err)
	}
	info, err := os.Stat(tmpName)
	if err != nil {
		return fmt.Errorf("convert video %d: %w", videoID, err)
	}
	if info.Size() == 0 {
		return fmt.Errorf("convert video %d: ffmpeg wrote nothing", videoID)
	}
	if err := os.Rename(tmpName, filepath.Join(dir, name)); err != nil {
		return fmt.Errorf("convert video %d: %w", videoID, err)
	}
	return nil
}

// soundCodecs returns the formats of the sound tracks of a video, in the
// order of the file, as the "tracks" job found them; none when it has
// not run yet.
func (c *Converter) soundCodecs(ctx context.Context, videoID int64) (codecs []string, err error) {
	rows, err := c.db.QueryContext(ctx, `SELECT codec FROM video_audio WHERE video_id = ? ORDER BY stream`, videoID)
	if err != nil {
		return nil, fmt.Errorf("read sound tracks of video %d: %w", videoID, err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		var codec string
		if err := rows.Scan(&codec); err != nil {
			return nil, fmt.Errorf("read sound tracks of video %d: %w", videoID, err)
		}
		codecs = append(codecs, codec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read sound tracks of video %d: %w", videoID, err)
	}
	return codecs, nil
}

// convertArgs builds the ffmpeg command. The copy keeps the first picture
// (V:0 leaves out cover images) and every sound track, in the same order,
// so the choice of language works on it too. Subtitles stay out: FranzPLAY
// shows them from its own copies.
func convertArgs(file string, plan video.ConvertPlan, sounds []string, threads int, out string) []string {
	args := []string{"-v", "error", "-nostdin", "-y", "-i", "file:" + file, "-map", "0:V:0"}
	if plan.CopyVideo {
		args = append(args, "-c:v", "copy")
	} else {
		// veryfast: a good picture in a time a Raspberry Pi can manage.
		args = append(args,
			"-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
			"-vf", "scale=-2:'min("+strconv.Itoa(video.MaxConvertHeight)+",ih)'")
	}
	if len(sounds) == 0 {
		// Sound tracks not listed yet: every one becomes stereo AAC.
		args = append(args, "-map", "0:a?", "-c:a", "aac", "-ac", "2", "-b:a", "192k")
	}
	for i, codec := range sounds {
		n := strconv.Itoa(i)
		args = append(args, "-map", "0:a:"+n)
		if video.CopyAudioToMP4(codec) {
			args = append(args, "-c:a:"+n, "copy")
		} else {
			args = append(args, "-c:a:"+n, "aac", "-ac:a:"+n, "2", "-b:a:"+n, "192k")
		}
	}
	return append(args,
		"-sn", "-dn", "-threads", strconv.Itoa(threads),
		// faststart puts the index at the beginning: the video starts at once.
		"-movflags", "+faststart", "-f", "mp4", "file:"+out)
}

// RemoveOrphanConverted deletes the files in the converted folder that no
// video uses any more, and conversions left half done. It must run before
// the job worker starts, so it never sees a copy being made.
func RemoveOrphanConverted(ctx context.Context, db *sql.DB, dataDir string) (removed int, err error) {
	return removeOrphans(ctx, db, filepath.Join(dataDir, ConvertedDir), "videos", "converted")
}
