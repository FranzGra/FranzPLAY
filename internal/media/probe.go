// Package media runs ffprobe and ffmpeg on the videos. They are always
// started from here, by FranzPLAY's job queue, one at a time.
package media

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// runFunc runs a program and returns what it printed. Tests replace it.
type runFunc func(ctx context.Context, program string, args ...string) ([]byte, error)

// run starts a program and waits for it. On failure the error carries the
// end of what the program printed on its error output, to explain why.
// It is for work someone is waiting for, like starting a video with
// another sound track.
func run(ctx context.Context, program string, args ...string) ([]byte, error) {
	return runWith(ctx, (*exec.Cmd).Start, program, args...)
}

// runInBackground is run for the job queue's work: covers, previews,
// copies. The program gets the lowest share of the processor and of the
// disk, so a video someone is watching never waits for it (see
// startInBackground).
func runInBackground(ctx context.Context, program string, args ...string) ([]byte, error) {
	return runWith(ctx, startInBackground, program, args...)
}

// runWith is run and runInBackground: start decides how the program starts.
func runWith(ctx context.Context, start func(*exec.Cmd) error, program string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, program, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := start(cmd)
	if err == nil {
		err = cmd.Wait()
	}
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if len(msg) > 500 {
			msg = "…" + msg[len(msg)-500:]
		}
		return nil, fmt.Errorf("%s: %w: %s", filepath.Base(program), err, msg)
	}
	return stdout.Bytes(), nil
}

// Prober reads duration, size and codecs of videos with ffprobe.
type Prober struct {
	db      *sql.DB
	ffprobe string // program to run
	run     runFunc
	now     func() time.Time
}

// NewProber returns a prober that runs the given ffprobe program.
func NewProber(db *sql.DB, ffprobe string) *Prober {
	return &Prober{db: db, ffprobe: ffprobe, run: runInBackground, now: time.Now}
}

// Handle is the job handler for jobs.Probe.
func (p *Prober) Handle(ctx context.Context, videoID int64) error {
	file, fingerprint, err := locate(ctx, p.db, videoID)
	if err != nil {
		return err
	}
	// "file:" makes ffprobe read the name as a file, even one with ":" in it.
	args := append(slices.Clone(video.ProbeArgs), "file:"+file)
	out, err := p.run(ctx, p.ffprobe, args...)
	if err != nil {
		return fmt.Errorf("read video %d: %w", videoID, err)
	}
	info, err := video.ParseProbe(out)
	if errors.Is(err, video.ErrNotVideo) {
		return fmt.Errorf("video %d: %w: %w", videoID, err, jobs.ErrPermanent)
	}
	if err != nil {
		return fmt.Errorf("read video %d: %w", videoID, err)
	}

	return p.save(ctx, videoID, fingerprint, info)
}

// save stores what ffprobe found and asks for the cover and the
// previews, which need the duration, for the subtitles inside the file,
// and for a copy for the browsers, which needs the formats. All happen together or not at all. Nothing is saved if the
// content changed while ffprobe read it: the scan has already asked for a
// new reading.
func (p *Prober) save(ctx context.Context, videoID int64, fingerprint string, info video.Info) (err error) {
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("save info of video %d: %w", videoID, err)
	}
	defer func() { err = finish(tx, err) }()

	res, err := tx.ExecContext(ctx, `
		UPDATE videos
		SET duration = ?, width = ?, height = ?, video_codec = ?, audio_codec = ?, container = ?, pixel_format = ?
		WHERE id = ? AND fingerprint = ?`,
		info.Duration.Seconds(), info.Width, info.Height, info.VideoCodec, info.AudioCodec, info.Container,
		info.PixelFormat, videoID, fingerprint)
	if err != nil {
		return fmt.Errorf("save info of video %d: %w", videoID, err)
	}
	if n, err := res.RowsAffected(); err != nil || n == 0 {
		return err // content changed meanwhile: nothing to do
	}
	if err := jobs.Enqueue(ctx, tx, videoID, jobs.Cover, false, p.now()); err != nil {
		return err
	}
	if err := jobs.Enqueue(ctx, tx, videoID, jobs.Preview, false, p.now()); err != nil {
		return err
	}
	if err := jobs.Enqueue(ctx, tx, videoID, jobs.Clip, false, p.now()); err != nil {
		return err
	}
	if err := jobs.Enqueue(ctx, tx, videoID, jobs.Tracks, false, p.now()); err != nil {
		return err
	}
	return jobs.Enqueue(ctx, tx, videoID, jobs.Convert, false, p.now())
}

// finish commits the transaction when err is nil, and rolls it back otherwise.
func finish(tx *sql.Tx, err error) error {
	if err != nil {
		if rbErr := tx.Rollback(); rbErr != nil {
			return errors.Join(err, fmt.Errorf("rollback: %w", rbErr))
		}
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

// errVideoGone means the video is no longer in the catalog.
var errVideoGone = errors.New("video no longer in the catalog")

// errVideoMissing means the video's file is not where it was last seen.
var errVideoMissing = errors.New("video file currently missing")

// locate returns the full path of a present video and its fingerprint.
func locate(ctx context.Context, db *sql.DB, videoID int64) (file, fingerprint string, err error) {
	var root, rel string
	var missing bool
	err = db.QueryRowContext(ctx, `
		SELECT l.path, v.path, v.fingerprint, v.missing_since IS NOT NULL
		FROM videos v JOIN libraries l ON l.id = v.library_id
		WHERE v.id = ?`, videoID).Scan(&root, &rel, &fingerprint, &missing)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", fmt.Errorf("video %d: %w: %w", videoID, errVideoGone, jobs.ErrPermanent)
	}
	if err != nil {
		return "", "", fmt.Errorf("find video %d: %w", videoID, err)
	}
	if missing {
		// Not permanent: if the disk comes back, so does the video.
		return "", "", fmt.Errorf("video %d: %w", videoID, errVideoMissing)
	}
	return filepath.Join(root, filepath.FromSlash(rel)), fingerprint, nil
}
