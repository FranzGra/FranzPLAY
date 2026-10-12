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

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// runFunc runs a program and returns what it printed. Tests replace it.
type runFunc func(ctx context.Context, program string, args ...string) ([]byte, error)

// run starts a program and waits for it. On failure the error carries the
// end of what the program printed on its error output, to explain why.
func run(ctx context.Context, program string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, program, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
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
}

// NewProber returns a prober that runs the given ffprobe program.
func NewProber(db *sql.DB, ffprobe string) *Prober {
	return &Prober{db: db, ffprobe: ffprobe, run: run}
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

	// Saved only if the content is still the one we read: if the file was
	// replaced meanwhile, the scan has already asked for a new reading.
	_, err = p.db.ExecContext(ctx, `
		UPDATE videos
		SET duration = ?, width = ?, height = ?, video_codec = ?, audio_codec = ?, container = ?
		WHERE id = ? AND fingerprint = ?`,
		info.Duration.Seconds(), info.Width, info.Height, info.VideoCodec, info.AudioCodec, info.Container,
		videoID, fingerprint)
	if err != nil {
		return fmt.Errorf("save info of video %d: %w", videoID, err)
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
