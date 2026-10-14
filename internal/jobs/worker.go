package jobs

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"runtime/debug"
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

// crashMessage is the error saved for a job that was running when
// FranzPLAY stopped without warning.
const crashMessage = "FranzPLAY stopped suddenly during this job (power cut, out of memory or crash)"

// resetInterrupted puts back in the queue the jobs that were still running
// when FranzPLAY started. A clean stop puts its job back by itself (see
// RunNext), so these were running when FranzPLAY died: a power cut, or
// the job itself crashed it. That counts as a failed attempt, so a video
// that crashes FranzPLAY every time is given up after MaxAttempts instead
// of crashing it again at every start, forever.
func (w *Worker) resetInterrupted(ctx context.Context) error {
	_, err := w.db.ExecContext(ctx, `
		UPDATE jobs SET state = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END,
			attempts = attempts + 1, last_error = ?, updated_at = ?
		WHERE state = 'running'`, MaxAttempts, crashMessage, w.now().Unix())
	if err != nil {
		return fmt.Errorf("put back interrupted jobs: %w", err)
	}
	return nil
}

// stopTimeout is how long saving the queue may take when FranzPLAY stops.
const stopTimeout = 5 * time.Second

// runHandler runs a job. A bug that panics in a job becomes the job's
// error, instead of stopping the whole of FranzPLAY.
func (w *Worker) runHandler(ctx context.Context, h Handler, j job) (err error) {
	defer func() {
		if r := recover(); r != nil {
			w.logger.ErrorContext(ctx, "job crashed", "kind", j.kind, "video", j.videoID,
				"panic", r, "stack", string(debug.Stack()))
			err = fmt.Errorf("%w: crashed: %v", ErrPermanent, r)
		}
	}()
	return h(ctx, j.videoID)
}

// job is one row of the queue.
type job struct {
	id       int64
	videoID  int64
	kind     Kind
	attempts int
	urgent   bool // someone is waiting for it: it never gives way
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
	if j.kind.givesWay() && !j.urgent {
		stopWatching = w.watchForOthers(jobCtx, j.id, yield)
	}
	start := time.Now()
	runErr := w.runHandler(jobCtx, h, j)
	stopWatching()
	cancel()
	gaveWay := errors.Is(context.Cause(yieldCtx), errGaveWay)
	yield(nil)

	if ctx.Err() != nil {
		// FranzPLAY is stopping: the job did not fail, it was interrupted.
		// It goes back in the queue as if it had not started.
		saveCtx, cancelSave := context.WithTimeout(context.WithoutCancel(ctx), stopTimeout)
		defer cancelSave()
		return true, w.giveBack(saveCtx, j)
	}
	if gaveWay {
		w.logger.InfoContext(ctx, "job paused for other work", "kind", j.kind, "video", j.videoID,
			"after", time.Since(start).Round(time.Second))
		return true, w.giveBack(ctx, j)
	}
	if later := (*LaterError)(nil); errors.As(runErr, &later) {
		w.logger.DebugContext(ctx, "job postponed", "kind", j.kind, "video", j.videoID, "until", later.Until)
		return true, w.postpone(ctx, j, later.Until)
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
func (w *Worker) watchForOthers(ctx context.Context, jobID int64, stop context.CancelCauseFunc) func() {
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
			waiting, err := w.othersWaiting(ctx, jobID)
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

// othersWaiting reports whether the running job jobID must give way to a
// job that is due: new work of a kind that never gives way, or a job
// someone is waiting for. It never must when someone is waiting for jobID
// itself. A job trying again after a failure waits for the end of the long
// one: offline, the internet lookups fail and come back every few minutes,
// and each would throw away hours of conversion.
func (w *Worker) othersWaiting(ctx context.Context, jobID int64) (bool, error) {
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
		placeholders = "NULL" // matches no kind
	}
	urgent, urgentArgs := w.kindsPlaceholders()
	args = append(args, urgentArgs...)
	args = append(args, jobID)
	var waiting bool
	err := w.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM jobs
		WHERE state = 'pending' AND run_after <= ?
		AND ((attempts = 0 AND kind IN (`+placeholders+`)) OR (urgent AND kind IN (`+urgent+`))))
		AND NOT EXISTS (SELECT 1 FROM jobs WHERE id = ? AND urgent)`, args...).Scan(&waiting)
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

// postpone puts a job that is not due yet back in the queue until a
// time. It is not a failed attempt.
func (w *Worker) postpone(ctx context.Context, j job, until time.Time) error {
	if _, err := w.db.ExecContext(ctx, `UPDATE jobs SET state = 'pending', run_after = ?, updated_at = ?
		WHERE id = ? AND state = 'running'`, until.Unix(), w.now().Unix(), j.id); err != nil {
		return fmt.Errorf("postpone job %d: %w", j.id, err)
	}
	return nil
}

// claimQuery finds the next job: its arguments are the time now, then the
// kinds, one per placeholder. The jobs_next index already holds the jobs
// in the order wanted, so nothing is sorted. SQLite, not knowing how many
// jobs wait, would rather pick another index and sort: INDEXED BY tells it
// which one to use.
func claimQuery(placeholders string) string {
	return `SELECT id, video_id, kind, attempts, urgent FROM jobs INDEXED BY jobs_next
		WHERE state = 'pending' AND run_after <= ? AND kind IN (` + placeholders + `)
		ORDER BY priority, id
		LIMIT 1`
}

// kindsPlaceholders returns "?, ?, ..." with one place per kind this
// worker can do, and the kinds to put there.
func (w *Worker) kindsPlaceholders() (string, []any) {
	kinds := make([]any, 0, len(w.handlers))
	placeholders := ""
	for k := range w.handlers {
		if placeholders != "" {
			placeholders += ", "
		}
		placeholders += "?"
		kinds = append(kinds, string(k))
	}
	return placeholders, kinds
}

// claim takes the oldest due job of a kind this worker can do and marks it
// running. Probes go first, since covers and previews need the duration
// they find; then the details files, read in an instant, then covers,
// which every page shows, then previews, then the subtitles inside the
// files, which mean reading the whole file, and last the conversions,
// which can take hours. Before all of them, the jobs someone is waiting
// for (urgent). That order is the column jobs.priority.
func (w *Worker) claim(ctx context.Context) (job, bool, error) {
	placeholders, kinds := w.kindsPlaceholders()
	if len(kinds) == 0 {
		return job{}, false, nil
	}

	now := w.now().Unix()
	args := append([]any{now}, kinds...)
	var j job
	var kind string
	err := w.db.QueryRowContext(ctx, claimQuery(placeholders), args...).Scan(&j.id, &j.videoID, &kind, &j.attempts, &j.urgent)
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
