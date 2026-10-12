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

	"github.com/FranzGra/FranzPLAY/internal/video"
)

// SubtitlesDir is the folder, inside the data folder, that holds the
// copies of the subtitles found inside the video files.
const SubtitlesDir = "subtitles"

// Subtitler copies the text subtitles inside the video files to WebVTT
// files the browser can show.
type Subtitler struct {
	db      *sql.DB
	ffprobe string // programs to run
	ffmpeg  string
	dataDir string
	run     runFunc
}

// NewSubtitler returns a subtitler that runs the given ffprobe and ffmpeg
// programs and writes in dataDir/subtitles.
func NewSubtitler(db *sql.DB, ffprobe, ffmpeg, dataDir string) *Subtitler {
	return &Subtitler{db: db, ffprobe: ffprobe, ffmpeg: ffmpeg, dataDir: dataDir, run: run}
}

// Handle is the job handler for jobs.Tracks. ffprobe lists the
// subtitles of the file; then one ffmpeg run copies them all, so the file
// is read once. It can take a while on a big file: ffmpeg must go through
// it all, since subtitles are spread along the whole video.
func (s *Subtitler) Handle(ctx context.Context, videoID int64) (err error) {
	file, fingerprint, err := locate(ctx, s.db, videoID)
	if err != nil {
		return err
	}
	out, err := s.run(ctx, s.ffprobe, append(slices.Clone(video.SubtitleProbeArgs), "file:"+file)...)
	if err != nil {
		return fmt.Errorf("subtitles of video %d: %w", videoID, err)
	}
	subs, err := video.ParseSubtitleStreams(out)
	if err != nil {
		return fmt.Errorf("subtitles of video %d: %w", videoID, err)
	}

	dir := filepath.Join(s.dataDir, SubtitlesDir)
	var names []string // the finished copies, in the order of subs
	if len(subs) > 0 {
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return fmt.Errorf("create subtitles folder: %w", err)
		}
		// Rule 6: ffmpeg writes in a temporary folder; the copies move out
		// only when all of them are finished.
		work, err := os.MkdirTemp(dir, ".new-*")
		if err != nil {
			return fmt.Errorf("subtitles of video %d: %w", videoID, err)
		}
		defer func() {
			if rmErr := os.RemoveAll(work); rmErr != nil {
				err = errors.Join(err, rmErr)
			}
		}()
		if _, err := s.run(ctx, s.ffmpeg, extractArgs(file, subs, work)...); err != nil {
			return fmt.Errorf("subtitles of video %d: %w", videoID, err)
		}
		for _, sub := range subs {
			name := subtitleName(videoID, fingerprint, sub.Stream)
			if err := os.Rename(filepath.Join(work, strconv.Itoa(sub.Stream)+".vtt"), filepath.Join(dir, name)); err != nil {
				return errors.Join(fmt.Errorf("subtitles of video %d: %w", videoID, err), removeAll(dir, names))
			}
			names = append(names, name)
		}
	}

	old, saved, err := s.save(ctx, videoID, fingerprint, subs, names)
	if err != nil {
		return errors.Join(err, removeAll(dir, names))
	}
	if !saved {
		// The file changed meanwhile: these copies belong to nobody.
		return removeAll(dir, names)
	}
	var stale []string
	for _, name := range old {
		if !slices.Contains(names, name) {
			stale = append(stale, name)
		}
	}
	return removeAll(dir, stale)
}

// save replaces the subtitles of a video with subs, whose copies are
// names. It returns the files of the subtitles it replaced. Nothing is
// saved (saved is false) if the content changed while ffmpeg read it: the
// scan has already asked for a new reading.
func (s *Subtitler) save(ctx context.Context, videoID int64, fingerprint string,
	subs []video.EmbeddedSubtitle, names []string,
) (old []string, saved bool, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, false, fmt.Errorf("save subtitles of video %d: %w", videoID, err)
	}
	defer func() { err = finish(tx, err) }()

	var same bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM videos WHERE id = ? AND fingerprint = ?)`,
		videoID, fingerprint).Scan(&same); err != nil {
		return nil, false, fmt.Errorf("save subtitles of video %d: %w", videoID, err)
	}
	if !same {
		return nil, false, nil
	}
	rows, err := tx.QueryContext(ctx, `SELECT file FROM video_subtitles WHERE video_id = ?`, videoID)
	if err != nil {
		return nil, false, fmt.Errorf("save subtitles of video %d: %w", videoID, err)
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, false, errors.Join(fmt.Errorf("save subtitles of video %d: %w", videoID, err), rows.Close())
		}
		old = append(old, name)
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		return nil, false, fmt.Errorf("save subtitles of video %d: %w", videoID, err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM video_subtitles WHERE video_id = ?`, videoID); err != nil {
		return nil, false, fmt.Errorf("save subtitles of video %d: %w", videoID, err)
	}
	for i, sub := range subs {
		if _, err := tx.ExecContext(ctx, `INSERT INTO video_subtitles (video_id, stream, lang, title, forced, file)
			VALUES (?, ?, ?, ?, ?, ?)`, videoID, sub.Stream, sub.Lang, sub.Title, sub.Forced, names[i]); err != nil {
			return nil, false, fmt.Errorf("save subtitles of video %d: %w", videoID, err)
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
