package media

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// convertedName is the copy of a video. Like the cover's, it changes when
// the content changes.
func convertedName(videoID int64, fingerprint string) string {
	return strings.TrimSuffix(coverName(videoID, fingerprint), ".jpg") + ".mp4"
}

// progressName is the file, in the work folder, where ffmpeg writes
// how far the copy of a video is, while it makes it.
func progressName(videoID int64) string {
	return ".progress-" + strconv.FormatInt(videoID, 10) + ".txt"
}

// ConvertedSoFar returns how many seconds of a video ffmpeg has put in its
// copy, while it makes it, from the progress file in the work folder.
// ok is false when no copy is being made.
func ConvertedSoFar(root content.Root, videoID int64) (seconds float64, ok bool, err error) {
	f, err := os.Open(filepath.Join(root.Work(), progressName(videoID)))
	if errors.Is(err, fs.ErrNotExist) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("read progress of video %d: %w", videoID, err)
	}
	defer func() { err = errors.Join(err, f.Close()) }()
	// ffmpeg adds a few lines every few seconds: the last ones are enough.
	info, err := f.Stat()
	if err != nil {
		return 0, false, fmt.Errorf("read progress of video %d: %w", videoID, err)
	}
	tail := make([]byte, min(info.Size(), 4096))
	if _, err := f.ReadAt(tail, info.Size()-int64(len(tail))); err != nil && !errors.Is(err, io.EOF) {
		return 0, false, fmt.Errorf("read progress of video %d: %w", videoID, err)
	}
	seconds, ok = parseProgress(tail)
	return seconds, ok, nil
}

// parseProgress reads the last "out_time_us=" line ffmpeg wrote with
// -progress: the time reached, in microseconds.
func parseProgress(data []byte) (float64, bool) {
	seconds, found := 0.0, false
	for line := range strings.Lines(string(data)) {
		value, ok := strings.CutPrefix(strings.TrimSpace(line), "out_time_us=")
		if !ok {
			continue
		}
		if us, err := strconv.ParseInt(value, 10, 64); err == nil && us >= 0 {
			seconds, found = float64(us)/1e6, true
		}
	}
	return seconds, found
}

// Converter makes, with ffmpeg, a copy of the videos that not every
// browser plays: an MP4 with H.264 picture and the sound tracks the
// browsers know. The video file itself is only read (rule 1).
type Converter struct {
	db      *sql.DB
	ffmpeg  string // program to run
	ffprobe string // program that reads the picture of videos read before pixel formats were kept
	root    content.Root
	threads int // how many processor cores ffmpeg may use
	run     runFunc
}

// NewConverter returns a converter that runs the given ffmpeg and ffprobe
// programs and writes in the folder of each video, in root. ffmpeg uses half the
// processor cores, so the site stays quick while a film is being encoded.
func NewConverter(db *sql.DB, ffmpeg, ffprobe string, root content.Root) *Converter {
	return &Converter{db: db, ffmpeg: ffmpeg, ffprobe: ffprobe, root: root,
		threads: max(1, runtime.NumCPU()/2), run: runInBackground}
}

// Handle is the job handler for jobs.Convert. For a video that plays as it
// is, it only forgets an old copy, if any.
func (c *Converter) Handle(ctx context.Context, videoID int64) (err error) {
	file, fingerprint, err := locate(ctx, c.db, videoID)
	if err != nil {
		return err
	}
	var videoCodec, audioCodec, pixels, old sql.NullString
	if err := c.db.QueryRowContext(ctx, `SELECT video_codec, audio_codec, pixel_format, converted
		FROM videos WHERE id = ?`, videoID).Scan(&videoCodec, &audioCodec, &pixels, &old); err != nil {
		return fmt.Errorf("read video %d: %w", videoID, err)
	}
	if !videoCodec.Valid {
		return fmt.Errorf("convert video %d: not read by ffprobe yet", videoID)
	}
	if !pixels.Valid {
		if pixels.String, err = c.readPixelFormat(ctx, videoID, file, fingerprint); err != nil {
			return err
		}
	}
	plan := video.PlanConversion(filepath.Ext(file), video.Info{
		VideoCodec: videoCodec.String, AudioCodec: audioCodec.String, PixelFormat: pixels.String})
	flat := c.root.Converted()
	if old.Valid && plan.Needed && c.isCopyOf(old.String, videoID, fingerprint) {
		if _, err := os.Stat(c.root.File(old.String, flat)); err == nil {
			return nil // already made, for this very content
		}
	}
	// Put in place and saved only if the content is still the one we used.
	code, name := "", ""
	save := func(tmp string) (bool, error) {
		same, err := content.IfSame(ctx, c.db, videoID, fingerprint, func(tx *sql.Tx) error {
			var saved any // NULL: no copy needed
			if tmp != "" {
				if err := c.root.Put(code, content.FileConverted, tmp); err != nil {
					return err
				}
				saved = name
			}
			_, err := tx.ExecContext(ctx, `UPDATE videos SET converted = ? WHERE id = ?`, saved, videoID)
			return err
		})
		if err != nil {
			return false, fmt.Errorf("save copy of video %d: %w", videoID, err)
		}
		return same, nil
	}
	var same bool
	if plan.Needed {
		if code, err = content.EnsureVideoFolder(ctx, c.db, c.root, videoID, fingerprint); err != nil {
			return err
		}
		name = content.Stored(code, content.FileConverted, "")
		same, err = c.convert(ctx, videoID, file, plan, save)
	} else {
		same, err = save("")
	}
	if err != nil || !same {
		return err // if the file changed meanwhile, this copy belongs to nobody
	}
	return c.root.RemoveNotKept(old.String, name, flat)
}

// isCopyOf reports whether a value of the database names the copy of this very
// content: in its folder, or in the old flat folder, where it is just as good.
// A film takes hours to make again.
func (c *Converter) isCopyOf(value string, videoID int64, fingerprint string) bool {
	if value == convertedName(videoID, fingerprint) {
		return true
	}
	code, ok, err := c.root.FolderOf(fingerprint)
	return err == nil && ok && content.SameFile(value, content.Stored(code, content.FileConverted, ""))
}

// readPixelFormat asks ffprobe how the picture of a video read before
// FranzPLAY kept pixel formats stores its colours, and keeps the answer.
func (c *Converter) readPixelFormat(ctx context.Context, videoID int64, file, fingerprint string) (string, error) {
	out, err := c.run(ctx, c.ffprobe, append(slices.Clone(video.ProbeArgs), "file:"+file)...)
	if err != nil {
		return "", fmt.Errorf("read picture of video %d: %w", videoID, err)
	}
	info, err := video.ParseProbe(out)
	if err != nil {
		return "", fmt.Errorf("read picture of video %d: %w", videoID, err)
	}
	if _, err := c.db.ExecContext(ctx, `UPDATE videos SET pixel_format = ? WHERE id = ? AND fingerprint = ?`,
		info.PixelFormat, videoID, fingerprint); err != nil {
		return "", fmt.Errorf("save picture of video %d: %w", videoID, err)
	}
	return info.PixelFormat, nil
}

// convert runs ffmpeg into a temporary file, given to save only when complete
// (rule 6). It returns what save says.
func (c *Converter) convert(ctx context.Context, videoID int64, file string, plan video.ConvertPlan,
	save func(tmp string) (bool, error),
) (same bool, err error) {
	sounds, err := c.soundCodecs(ctx, videoID)
	if err != nil {
		return false, err
	}
	dir, err := c.root.MakeWork()
	if err != nil {
		return false, err
	}
	tmp, err := os.CreateTemp(dir, ".new-*.mp4")
	if err != nil {
		return false, fmt.Errorf("convert video %d: %w", videoID, err)
	}
	tmpName := tmp.Name()
	if err := tmp.Close(); err != nil {
		return false, errors.Join(fmt.Errorf("convert video %d: %w", videoID, err), os.Remove(tmpName))
	}
	defer func() {
		// Left over only when something failed; after success it was renamed.
		if rmErr := os.Remove(tmpName); rmErr != nil && !errors.Is(rmErr, fs.ErrNotExist) {
			err = errors.Join(err, rmErr)
		}
	}()

	progress := filepath.Join(dir, progressName(videoID))
	defer func() {
		if rmErr := os.Remove(progress); rmErr != nil && !errors.Is(rmErr, fs.ErrNotExist) {
			err = errors.Join(err, rmErr)
		}
	}()
	stopFollowing := c.follow(ctx, videoID)
	_, err = c.run(ctx, c.ffmpeg, convertArgs(file, plan, sounds, c.threads, progress, tmpName)...)
	stopFollowing()
	if err != nil {
		return false, fmt.Errorf("convert video %d: %w", videoID, err)
	}
	info, err := os.Stat(tmpName)
	if err != nil {
		return false, fmt.Errorf("convert video %d: %w", videoID, err)
	}
	if info.Size() == 0 {
		return false, fmt.Errorf("convert video %d: ffmpeg wrote nothing", videoID)
	}
	return save(tmpName)
}

// followEvery is how often a conversion tells the queue how far it is:
// ffmpeg writes it every 5 seconds (-stats_period).
const followEvery = 5 * time.Second

// follow tells the job queue how far ffmpeg is, from what it writes with
// -progress, until the returned function is called.
func (c *Converter) follow(ctx context.Context, videoID int64) (stop func()) {
	var duration sql.NullInt64
	if err := c.db.QueryRowContext(ctx, `SELECT duration FROM videos WHERE id = ?`, videoID).Scan(&duration); err != nil ||
		duration.Int64 <= 0 {
		return func() {}
	}
	total := float64(duration.Int64)
	jobs.Report(ctx, jobs.Progress{Percent: 0, Total: total})
	quit, ended := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(ended)
		ticker := time.NewTicker(followEvery)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-quit:
				return
			case <-ticker.C:
			}
			if done, ok, err := ConvertedSoFar(c.root, videoID); err == nil && ok {
				done = min(done, total)
				jobs.Report(ctx, jobs.Progress{Percent: done * 100 / total, Done: done, Total: total})
			}
		}
	}()
	return func() {
		close(quit)
		<-ended
	}
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

// encodeFilter prepares the picture to be encoded again:
//   - yadif joins the two halves of the pictures of old TV recordings and
//     DVDs (interlaced), which would show as comb-like stripes; it leaves
//     the other pictures alone;
//   - scale makes it at most MaxConvertHeight tall, and of even width and
//     height, which H.264 needs (a 853x481 video would make it fail).
var encodeFilter = "yadif=deint=interlaced," +
	"scale=-2:'min(" + strconv.Itoa(video.MaxConvertHeight) + ",trunc(ih/2)*2)'"

// convertArgs builds the ffmpeg command. The copy keeps the first picture
// (V:0 leaves out cover images) and every sound track, in the same order,
// so the choice of language works on it too. Subtitles stay out: FranzPLAY
// shows them from its own copies.
//
// ffmpeg writes how far it is in the file progress, every few seconds.
func convertArgs(file string, plan video.ConvertPlan, sounds []string, threads int, progress, out string) []string {
	args := []string{"-v", "error", "-nostdin", "-y", "-i", "file:" + file, "-map", "0:V:0"}
	if plan.CopyVideo {
		args = append(args, "-c:v", "copy")
	} else {
		// veryfast: a good picture in a time a Raspberry Pi can manage.
		args = append(args,
			"-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
			"-vf", encodeFilter)
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
		"-progress", "file:"+progress, "-stats_period", "5",
		// faststart puts the index at the beginning: the video starts at once.
		"-movflags", "+faststart", "-f", "mp4", "file:"+out)
}

// RemoveOrphanConverted deletes the files in the converted folder that no
// video uses any more, and conversions left half done. It must run before
// the job worker starts, so it never sees a copy being made.
func RemoveOrphanConverted(ctx context.Context, db *sql.DB, root content.Root) (removed int, err error) {
	return removeOrphans(ctx, db, root.Converted(), "videos", "converted")
}
