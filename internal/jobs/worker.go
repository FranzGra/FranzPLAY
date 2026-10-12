package jobs

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"time"
)

// Handler does one kind of job for one video.
type Handler func(ctx context.Context, videoID int64) error

// jobTimeout stops a job that takes far too long, like ffmpeg stuck on a
// broken file. The longest real job (a cover of a long film) takes seconds.
const jobTimeout = 10 * time.Minute

// idleCheck is how often the worker looks at the queue when nobody wakes it,
// for example to retry a job whose waiting time is over.
const idleCheck = 30 * time.Second

// Worker takes jobs from the queue and runs them, one at a time.
type Worker struct {
	db       *sql.DB
	handlers map[Kind]Handler
	logger   *slog.Logger
	now      func() time.Time
	wake     chan struct{}
}

// NewWorker returns a worker for the given kinds of job. Jobs of a kind
// with no handler stay in the queue untouched.
func NewWorker(db *sql.DB, handlers map[Kind]Handler, logger *slog.Logger) *Worker {
	return &Worker{
		db:       db,
		handlers: handlers,
		logger:   logger,
		now:      time.Now,
		wake:     make(chan struct{}, 1),
	}
}

// Wake tells the worker there may be new jobs. It never blocks.
func (w *Worker) Wake() {
	select {
	case w.wake <- struct{}{}:
	default: // already woken
	}
}

// Run works through the queue until ctx is cancelled.
func (w *Worker) Run(ctx context.Context) {
	if err := w.resetInterrupted(ctx); err != nil {
		w.logger.ErrorContext(ctx, "reset interrupted jobs", "error", err)
	}
	ticker := time.NewTicker(idleCheck)
	defer ticker.Stop()
	for {
		ran, err := w.RunNext(ctx)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			w.logger.ErrorContext(ctx, "job queue", "error", err)
		}
		if ran && err == nil {
			continue // there may be more: look again right away
		}
		select {
		case <-ctx.Done():
			return
		case <-w.wake:
		case <-ticker.C:
		}
	}
}

// resetInterrupted puts back in the queue the jobs that were running when
// FranzPLAY last stopped.
func (w *Worker) resetInterrupted(ctx context.Context) error {
	_, err := w.db.ExecContext(ctx,
		`UPDATE jobs SET state = 'pending', updated_at = ? WHERE state = 'running'`, w.now().Unix())
	return err
}

// job is one row of the queue.
type job struct {
	id       int64
	videoID  int64
	kind     Kind
	attempts int
}

// RunNext runs the next job that is due, if there is one, and reports
// whether it ran one. The job's own failure is saved in the queue, not
// returned: the error is only for problems with the queue itself.
func (w *Worker) RunNext(ctx context.Context) (bool, error) {
	j, ok, err := w.claim(ctx)
	if err != nil || !ok {
		return false, err
	}

	h := w.handlers[j.kind]
	jobCtx, cancel := context.WithTimeout(ctx, jobTimeout)
	start := time.Now()
	runErr := h(jobCtx, j.videoID)
	cancel()

	if ctx.Err() != nil {
		// FranzPLAY is stopping: the job did not fail, it was interrupted.
		// It stays "running" and is put back in the queue at the next start.
		return true, nil //nolint:nilerr // an interrupted job is not a queue error

	}
	if runErr == nil {
		w.logger.InfoContext(ctx, "job done", "kind", j.kind, "video", j.videoID,
			"duration", time.Since(start).Round(time.Millisecond))
		return true, w.finish(ctx, j, done, w.now(), "")
	}

	attempts := j.attempts + 1
	next, runAfter := afterFailure(attempts, runErr, w.now())
	w.logger.WarnContext(ctx, "job failed", "kind", j.kind, "video", j.videoID,
		"attempt", attempts, "will_retry", next == pending, "error", runErr)
	return true, w.finish(ctx, j, next, runAfter, runErr.Error())
}

// claim takes the oldest due job of a kind this worker can do and marks it
// running. Probes go first: covers need the duration they find.
func (w *Worker) claim(ctx context.Context) (job, bool, error) {
	kinds := make([]any, 0, len(w.handlers))
	placeholders := ""
	for k := range w.handlers {
		if placeholders != "" {
			placeholders += ", "
		}
		placeholders += "?"
		kinds = append(kinds, string(k))
	}
	if len(kinds) == 0 {
		return job{}, false, nil
	}

	now := w.now().Unix()
	args := append([]any{now}, kinds...)
	var j job
	var kind string
	err := w.db.QueryRowContext(ctx, `
		SELECT id, video_id, kind, attempts FROM jobs
		WHERE state = 'pending' AND run_after <= ? AND kind IN (`+placeholders+`)
		ORDER BY kind = 'probe' DESC, id
		LIMIT 1`, args...).Scan(&j.id, &j.videoID, &kind, &j.attempts)
	if errors.Is(err, sql.ErrNoRows) {
		return job{}, false, nil
	}
	if err != nil {
		return job{}, false, fmt.Errorf("find next job: %w", err)
	}
	j.kind = Kind(kind)

	if _, err := w.db.ExecContext(ctx,
		`UPDATE jobs SET state = 'running', updated_at = ? WHERE id = ?`, now, j.id); err != nil {
		return job{}, false, fmt.Errorf("start job %d: %w", j.id, err)
	}
	return j, true, nil
}

// finish saves how a job ended. If the job was asked for again while it
// ran (the file changed meanwhile), it is no longer "running" and is left
// pending, so it runs again on the new content.
func (w *Worker) finish(ctx context.Context, j job, s state, runAfter time.Time, lastError string) error {
	attempts := j.attempts
	if s != done {
		attempts++
	}
	_, err := w.db.ExecContext(ctx, `
		UPDATE jobs SET state = ?, attempts = ?, last_error = ?, run_after = ?, updated_at = ?
		WHERE id = ? AND state = 'running'`,
		string(s), attempts, lastError, runAfter.Unix(), w.now().Unix(), j.id)
	if err != nil {
		return fmt.Errorf("save job %d: %w", j.id, err)
	}
	return nil
}
