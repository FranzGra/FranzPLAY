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

// errGaveWay is why a job that gives way was stopped: other work arrived.
var errGaveWay = errors.New("stopped to let other jobs run first")

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
	changed  func()
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
		changed:  func() {},
	}
}

// OnChange sets a function called whenever a job starts or ends, so the
// administrator's page can follow the queue. Call it before Run.
func (w *Worker) OnChange(f func()) {
	w.changed = f
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
	w.changed()
	defer w.changed()

	h := w.handlers[j.kind]
	yieldCtx, yield := context.WithCancelCause(ctx)
	jobCtx, cancel := context.WithTimeout(yieldCtx, j.kind.timeout())
	stopWatching := func() {}
	if j.kind.givesWay() {
		stopWatching = w.watchForOthers(jobCtx, yield)
	}
	start := time.Now()
	runErr := h(jobCtx, j.videoID)
	stopWatching()
	cancel()
	gaveWay := errors.Is(context.Cause(yieldCtx), errGaveWay)
	yield(nil)

	if ctx.Err() != nil {
		// FranzPLAY is stopping: the job did not fail, it was interrupted.
		// It stays "running" and is put back in the queue at the next start.
		return true, nil //nolint:nilerr // an interrupted job is not a queue error
	}
	if gaveWay {
		w.logger.InfoContext(ctx, "job paused for other work", "kind", j.kind, "video", j.videoID,
			"after", time.Since(start).Round(time.Second))
		return true, w.giveBack(ctx, j)
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

// watchForOthers watches the queue while a job that gives way runs, and
// stops it with errGaveWay as soon as another job is due. The returned
// function ends the watch, and returns once it has ended.
func (w *Worker) watchForOthers(ctx context.Context, stop context.CancelCauseFunc) func() {
	quit := make(chan struct{})
	ended := make(chan struct{})
	go func() {
		defer close(ended)
		ticker := time.NewTicker(idleCheck)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-quit:
				return
			case <-w.wake:
			case <-ticker.C:
			}
			waiting, err := w.othersWaiting(ctx)
			if err != nil {
				if ctx.Err() == nil {
					w.logger.ErrorContext(ctx, "job queue", "error", err)
				}
				continue
			}
			if waiting {
				stop(errGaveWay)
				return
			}
		}
	}()
	return func() {
		close(quit)
		<-ended
	}
}

// othersWaiting reports whether a job that does not give way is due.
func (w *Worker) othersWaiting(ctx context.Context) (bool, error) {
	args := []any{w.now().Unix()}
	placeholders := ""
	for k := range w.handlers {
		if k.givesWay() {
			continue
		}
		if placeholders != "" {
			placeholders += ", "
		}
		placeholders += "?"
		args = append(args, string(k))
	}
	if placeholders == "" {
		return false, nil
	}
	var waiting bool
	err := w.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM jobs
		WHERE state = 'pending' AND run_after <= ? AND kind IN (`+placeholders+`))`, args...).Scan(&waiting)
	if err != nil {
		return false, fmt.Errorf("look for waiting jobs: %w", err)
	}
	return waiting, nil
}

// giveBack puts a job that gave way back in the queue, as if it had not
// started: it is not a failed attempt.
func (w *Worker) giveBack(ctx context.Context, j job) error {
	if _, err := w.db.ExecContext(ctx, `UPDATE jobs SET state = 'pending', updated_at = ?
		WHERE id = ? AND state = 'running'`, w.now().Unix(), j.id); err != nil {
		return fmt.Errorf("put back job %d: %w", j.id, err)
	}
	return nil
}

// claim takes the oldest due job of a kind this worker can do and marks it
// running. Probes go first, since covers and previews need the duration
// they find; then the details files, read in an instant, then covers,
// which every page shows, then previews, then the subtitles inside the
// files, which mean reading the whole file, and last the conversions,
// which can take hours.
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
		ORDER BY CASE kind WHEN 'probe' THEN 0 WHEN 'details' THEN 1 WHEN 'cover' THEN 2
			WHEN 'preview' THEN 3 WHEN 'convert' THEN 5 ELSE 4 END, id
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
