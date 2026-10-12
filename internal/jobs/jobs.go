// Package jobs runs FranzPLAY's heavy work (ffprobe, ffmpeg) from a queue
// kept in the database, one job at a time (rule 5). The queue survives a
// restart: a job that was running when the program stopped starts again.
package jobs

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// Kind is a type of work. The list is closed: only these exist.
type Kind string

// The kinds of job.
const (
	Probe   Kind = "probe"   // read duration, size and codecs with ffprobe
	Cover   Kind = "cover"   // make the cover image
	Preview Kind = "preview" // make the small frames shown over the timeline
	Tracks  Kind = "tracks"  // list the languages inside the file, copy its subtitles
)

// state is where a job is in its life. It is stored as text in the database.
type state string

const (
	pending state = "pending"
	running state = "running"
	done    state = "done"
	failed  state = "failed"
)

// ErrPermanent marks a failure that trying again cannot fix, like a file
// that is not a video. Handlers wrap it: fmt.Errorf("...: %w", jobs.ErrPermanent).
var ErrPermanent = errors.New("permanent failure")

// MaxAttempts is how many times a job is tried before it is marked failed.
const MaxAttempts = 3

// retryDelay is how long to wait before trying a failed job again.
// It grows with each attempt: 5 minutes, then 10.
func retryDelay(attempts int) time.Duration {
	return time.Duration(attempts) * 5 * time.Minute
}

// afterFailure decides what happens to a job that just failed for the
// given time. It is pure, so every case is a simple test.
func afterFailure(attempts int, err error, now time.Time) (state, time.Time) {
	if errors.Is(err, ErrPermanent) || attempts >= MaxAttempts {
		return failed, now
	}
	return pending, now.Add(retryDelay(attempts))
}

// execer is what Enqueue needs: a database or a transaction.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// Enqueue asks for a job on a video. If the job already exists it starts
// again from scratch, unless onlyIfNotDone is set and it already succeeded.
func Enqueue(ctx context.Context, db execer, videoID int64, kind Kind, onlyIfNotDone bool, now time.Time) error {
	query := `
		INSERT INTO jobs (video_id, kind, state, updated_at) VALUES (?, ?, 'pending', ?)
		ON CONFLICT (video_id, kind) DO UPDATE
		SET state = 'pending', attempts = 0, last_error = '', run_after = 0, updated_at = excluded.updated_at`
	if onlyIfNotDone {
		query += ` WHERE state != 'done'`
	}
	if _, err := db.ExecContext(ctx, query, videoID, string(kind), now.Unix()); err != nil {
		return fmt.Errorf("enqueue %s job for video %d: %w", kind, videoID, err)
	}
	return nil
}
