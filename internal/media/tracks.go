package media

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/FranzGra/FranzPLAY/internal/safefile"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// SubtitlesDir is the folder, inside the data folder, that holds the
// copies of the subtitles found inside the video files.
const SubtitlesDir = "subtitles"

// Tracker reads the sound tracks and the subtitles inside the video
// files, and copies the text subtitles to WebVTT files the browser can show.
type Tracker struct {
	db      *sql.DB
	ffprobe string // programs to run
	ffmpeg  string
	dataDir string
	run     runFunc
}

// NewTracker returns a tracker that runs the given ffprobe and ffmpeg
// programs and writes in dataDir/subtitles.
func NewTracker(db *sql.DB, ffprobe, ffmpeg, dataDir string) *Tracker {
	return &Tracker{db: db, ffprobe: ffprobe, ffmpeg: ffmpeg, dataDir: dataDir, run: runInBackground}
}

// Handle is the job handler for jobs.Tracks. ffprobe lists the tracks of
// the file; then one ffmpeg run copies the subtitles not copied yet, so
// the file is read once. It can take a while on a big file: ffmpeg must
// go through it all, since subtitles are spread along the whole video.
func (t *Tracker) Handle(ctx context.Context, videoID int64) (err error) {
	file, fingerprint, err := locate(ctx, t.db, videoID)
	if err != nil {
		return err
	}
	out, err := t.run(ctx, t.ffprobe, append(slices.Clone(video.TrackProbeArgs), "file:"+file)...)
	if err != nil {
		return fmt.Errorf("tracks of video %d: %w", videoID, err)
	}
	tracks, err := video.ParseTracks(out)
	if err != nil {
		return fmt.Errorf("tracks of video %d: %w", videoID, err)
	}

	// A copy's name changes with the content: one already there is right.
	dir := filepath.Join(t.dataDir, SubtitlesDir)
	names := make([]string, len(tracks.Subtitles)) // the copies, in the order of the subtitles
	var toCopy []video.EmbeddedSubtitle
	for i, sub := range tracks.Subtitles {
		names[i] = subtitleName(videoID, fingerprint, sub.Stream)
		if _, err := os.Stat(filepath.Join(dir, names[i])); err != nil {
			toCopy = append(toCopy, sub)
		}
	}
	made, err := t.copySubtitles(ctx, videoID, file, fingerprint, toCopy)
	if err != nil {
		return err
	}

	old, saved, err := t.save(ctx, videoID, fingerprint, tracks, names)
	if err != nil {
		return errors.Join(err, removeAll(dir, made))
	}
	if !saved {
		// The file changed meanwhile: these copies belong to nobody.
		return removeAll(dir, made)
	}
	var stale []string
	for _, name := range old {
		if !slices.Contains(names, name) {
			stale = append(stale, name)
		}
	}
	return removeAll(dir, stale)
}

// copySubtitles copies subs out of the file with one ffmpeg run and
// returns the names of the copies.
func (t *Tracker) copySubtitles(ctx context.Context, videoID int64, file, fingerprint string,
	subs []video.EmbeddedSubtitle,
) (made []string, err error) {
	if len(subs) == 0 {
		return nil, nil
	}
	dir := filepath.Join(t.dataDir, SubtitlesDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, fmt.Errorf("create subtitles folder: %w", err)
	}
	// Rule 6: ffmpeg writes in a temporary folder; the copies move out
	// only when all of them are finished.
	work, err := os.MkdirTemp(dir, ".new-*")
	if err != nil {
		return nil, fmt.Errorf("subtitles of video %d: %w", videoID, err)
	}
	defer func() {
		if rmErr := os.RemoveAll(work); rmErr != nil {
			err = errors.Join(err, rmErr)
		}
	}()
	if _, err := t.run(ctx, t.ffmpeg, extractArgs(file, subs, work)...); err != nil {
		return nil, fmt.Errorf("subtitles of video %d: %w", videoID, err)
	}
	for _, sub := range subs {
		name := subtitleName(videoID, fingerprint, sub.Stream)
		if err := safefile.Rename(filepath.Join(work, strconv.Itoa(sub.Stream)+".vtt"), filepath.Join(dir, name)); err != nil {
			return nil, errors.Join(fmt.Errorf("subtitles of video %d: %w", videoID, err), removeAll(dir, made))
		}
		made = append(made, name)
	}
	return made, nil
}

// save replaces the tracks of a video; names are the copies of its
// subtitles. It returns the copies of the subtitles it replaced. Nothing
// is saved (saved is false) if the content changed while ffmpeg read it:
// the scan has already asked for a new reading.
func (t *Tracker) save(ctx context.Context, videoID int64, fingerprint string,
	tracks video.Tracks, names []string,
) (old []string, saved bool, err error) {
	tx, err := t.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, false, fmt.Errorf("save tracks of video %d: %w", videoID, err)
	}
	defer func() { err = finish(tx, err) }()

	var same bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM videos WHERE id = ? AND fingerprint = ?)`,
		videoID, fingerprint).Scan(&same); err != nil {
		return nil, false, fmt.Errorf("save tracks of video %d: %w", videoID, err)
	}
	if !same {
		return nil, false, nil
	}
	rows, err := tx.QueryContext(ctx, `SELECT file FROM video_subtitles WHERE video_id = ?`, videoID)
	if err != nil {
		return nil, false, fmt.Errorf("save tracks of video %d: %w", videoID, err)
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, false, errors.Join(fmt.Errorf("save tracks of video %d: %w", videoID, err), rows.Close())
		}
		old = append(old, name)
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		return nil, false, fmt.Errorf("save tracks of video %d: %w", videoID, err)
	}
	for _, q := range []string{`DELETE FROM video_subtitles WHERE video_id = ?`, `DELETE FROM video_audio WHERE video_id = ?`} {
		if _, err := tx.ExecContext(ctx, q, videoID); err != nil {
			return nil, false, fmt.Errorf("save tracks of video %d: %w", videoID, err)
		}
	}
	for i, sub := range tracks.Subtitles {
		if _, err := tx.ExecContext(ctx, `INSERT INTO video_subtitles (video_id, stream, lang, title, forced, file)
			VALUES (?, ?, ?, ?, ?, ?)`, videoID, sub.Stream, sub.Lang, sub.Title, sub.Forced, names[i]); err != nil {
			return nil, false, fmt.Errorf("save tracks of video %d: %w", videoID, err)
		}
	}
	for _, a := range tracks.Audio {
		if _, err := tx.ExecContext(ctx, `INSERT INTO video_audio (video_id, stream, lang, title, codec, channels, is_default)
			VALUES (?, ?, ?, ?, ?, ?, ?)`, videoID, a.Stream, a.Lang, a.Title, a.Codec, a.Channels, a.Default); err != nil {
			return nil, false, fmt.Errorf("save tracks of video %d: %w", videoID, err)
		}
	}
	return old, true, nil
}

// extractArgs builds the ffmpeg command that copies every subtitle in
// subs, as WebVTT, to work/<stream>.vtt, reading the file once.
func extractArgs(file string, subs []video.EmbeddedSubtitle, work string) []string {
	args := []string{"-v", "error", "-y", "-i", "file:" + file}
	for _, sub := range subs {
		n := strconv.Itoa(sub.Stream)
		args = append(args, "-map", "0:"+n, "-c:s", "webvtt", "-f", "webvtt", filepath.Join(work, n+".vtt"))
	}
	return args
}

// subtitleName is the copy of a subtitle. Like the covers, it changes
// when the video's content changes.
func subtitleName(videoID int64, fingerprint string, stream int) string {
	return strings.TrimSuffix(coverName(videoID, fingerprint), ".jpg") + "-" + strconv.Itoa(stream) + ".vtt"
}

// removeAll deletes files of the data folder, going on after an error.
func removeAll(dir string, names []string) error {
	var errs []error
	for _, name := range names {
		errs = append(errs, removeFile(dir, name))
	}
	return errors.Join(errs...)
}

// RemoveOrphanSubtitles deletes the files in the subtitles folder that no
// video uses any more, and work left half done. Like RemoveOrphanCovers,
// it must run before the job worker starts.
func RemoveOrphanSubtitles(ctx context.Context, db *sql.DB, dataDir string) (removed int, err error) {
	return removeOrphans(ctx, db, filepath.Join(dataDir, SubtitlesDir), "video_subtitles", "file")
}
