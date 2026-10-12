package jobs

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// maxFailedShown is how many failed jobs the administrator's page lists.
// More than that means something is broken for all of them, and the
// first ones already say what.
const maxFailedShown = 100

// Errors of the administrator's API.
var (
	errJobNotFound = errors.New("job not found")
	errNotFailed   = errors.New("only a failed job can be tried again")
)

// Overview is the state of the queue, as the administrator sees it.
type Overview struct {
	Waiting     int         `json:"waiting"`  // to do, now or later
	Retrying    int         `json:"retrying"` // of those, failed before and waiting to try again
	Done        int         `json:"done"`
	Running     *JobView    `json:"running"` // null when the worker rests
	Failed      []JobView   `json:"failed"`  // the newest first, at most maxFailedShown
	FailedTotal int         `json:"failedTotal"`
	Kinds       []KindState `json:"kinds"`
}

// KindState says whether FranzPLAY can do a kind of job: it cannot when
// ffprobe or ffmpeg is missing, and those jobs wait.
type KindState struct {
	Kind      Kind `json:"kind"`
	Available bool `json:"available"`
}

// JobView is one job on the administrator's page.
type JobView struct {
	ID       int64     `json:"id"`
	Kind     Kind      `json:"kind"`
	VideoID  int64     `json:"videoId"`
	Title    string    `json:"title"`
	Attempts int       `json:"attempts"`
	Error    string    `json:"error"`
	At       time.Time `json:"at"` // when it started (running) or last failed
}

// allKinds is every kind of job, in the order they run.
var allKinds = []Kind{Probe, Cover, Preview, Tracks, Convert}

// Routes adds the queue's API for administrators to mux:
//
//	GET  /api/jobs             the Overview
//	POST /api/jobs/{id}/retry  try a failed job again
//	POST /api/jobs/retry       try every failed job again {count}
//
// wake tells the worker there is work, changed tells the open pages.
func Routes(db *sql.DB, available map[Kind]bool, wake, changed func(), logger *slog.Logger) func(mux *http.ServeMux) {
	a := admin{db: db, available: available, wake: wake, changed: changed, logger: logger,
		now: time.Now, account: users.FromContext}
	return a.routes
}

type admin struct {
	db        *sql.DB
	available map[Kind]bool
	wake      func()
	changed   func()
	logger    *slog.Logger
	now       func() time.Time
	account   func(context.Context) (users.Account, bool)
}

func (a admin) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/jobs", a.only(a.handleOverview))
	mux.HandleFunc("POST /api/jobs/{id}/retry", a.only(a.handleRetry))
	mux.HandleFunc("POST /api/jobs/retry", a.only(a.handleRetryAll))
}

// only lets only administrators through.
func (a admin) only(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		who, ok := a.account(r.Context())
		switch {
		case !ok:
			respond.Error(w, r, a.logger, http.StatusUnauthorized, "login required")
		case who.Role != users.Admin:
			respond.Error(w, r, a.logger, http.StatusForbidden, "administrators only")
		default:
			next(w, r)
		}
	}
}

func (a admin) handleOverview(w http.ResponseWriter, r *http.Request) {
	o, err := a.overview(r.Context())
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	respond.JSON(w, r, a.logger, http.StatusOK, o)
}

func (a admin) handleRetry(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		respond.Error(w, r, a.logger, http.StatusNotFound, errJobNotFound.Error())
		return
	}
	switch err := a.retry(r.Context(), id); {
	case errors.Is(err, errJobNotFound):
		respond.Error(w, r, a.logger, http.StatusNotFound, err.Error())
	case errors.Is(err, errNotFailed):
		respond.Error(w, r, a.logger, http.StatusConflict, err.Error())
	case err != nil:
		respond.InternalError(w, r, a.logger, err)
	default:
		a.wake()
		a.changed()
		w.WriteHeader(http.StatusNoContent)
	}
}

func (a admin) handleRetryAll(w http.ResponseWriter, r *http.Request) {
	n, err := a.retryAll(r.Context())
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	if n > 0 {
		a.wake()
		a.changed()
	}
	who, _ := a.account(r.Context())
	a.logger.InfoContext(r.Context(), "failed jobs retried", "count", n, "by", who.Name)
	respond.JSON(w, r, a.logger, http.StatusOK, map[string]int{"count": n})
}

// overview reads the state of the queue.
func (a admin) overview(ctx context.Context) (_ Overview, err error) {
	o := Overview{Failed: []JobView{}}
	for _, k := range allKinds {
		o.Kinds = append(o.Kinds, KindState{Kind: k, Available: a.available[k]})
	}
	err = a.db.QueryRowContext(ctx, `
		SELECT
			count(*) FILTER (WHERE state = 'pending'),
			count(*) FILTER (WHERE state = 'pending' AND attempts > 0),
			count(*) FILTER (WHERE state = 'done'),
			count(*) FILTER (WHERE state = 'failed')
		FROM jobs`).Scan(&o.Waiting, &o.Retrying, &o.Done, &o.FailedTotal)
	if err != nil {
		return Overview{}, fmt.Errorf("count jobs: %w", err)
	}

	running, err := a.list(ctx, `state = 'running' ORDER BY j.updated_at LIMIT 1`)
	if err != nil {
		return Overview{}, err
	}
	if len(running) > 0 {
		o.Running = &running[0]
	}
	if o.Failed, err = a.list(ctx, `state = 'failed' ORDER BY j.updated_at DESC, j.id DESC LIMIT ?`, maxFailedShown); err != nil {
		return Overview{}, err
	}
	return o, nil
}

// list reads the jobs matching where (which also orders and limits).
func (a admin) list(ctx context.Context, where string, args ...any) (_ []JobView, err error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT j.id, j.kind, j.video_id, v.title, j.attempts, j.last_error, j.updated_at
		FROM jobs j JOIN videos v ON v.id = j.video_id
		WHERE `+where, args...)
	if err != nil {
		return nil, fmt.Errorf("list jobs: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := []JobView{}
	for rows.Next() {
		var j JobView
		var kind string
		var at int64
		if err := rows.Scan(&j.ID, &kind, &j.VideoID, &j.Title, &j.Attempts, &j.Error, &at); err != nil {
			return nil, fmt.Errorf("list jobs: %w", err)
		}
		j.Kind = Kind(kind)
		j.At = time.Unix(at, 0).UTC()
		out = append(out, j)
	}
	return out, rows.Err()
}

// retry puts a failed job back in the queue, as if it were new.
func (a admin) retry(ctx context.Context, id int64) error {
	res, err := a.db.ExecContext(ctx, `
		UPDATE jobs SET state = 'pending', attempts = 0, last_error = '', run_after = 0, updated_at = ?
		WHERE id = ? AND state = 'failed'`, a.now().Unix(), id)
	if err != nil {
		return fmt.Errorf("retry job %d: %w", id, err)
	}
	if n, err := res.RowsAffected(); err != nil {
		return fmt.Errorf("retry job %d: %w", id, err)
	} else if n == 1 {
		return nil
	}
	var exists int
	if err := a.db.QueryRowContext(ctx, `SELECT count(*) FROM jobs WHERE id = ?`, id).Scan(&exists); err != nil {
		return fmt.Errorf("retry job %d: %w", id, err)
	}
	if exists == 0 {
		return errJobNotFound
	}
	return errNotFailed
}

// retryAll puts every failed job back in the queue and says how many.
func (a admin) retryAll(ctx context.Context) (int, error) {
	res, err := a.db.ExecContext(ctx, `
		UPDATE jobs SET state = 'pending', attempts = 0, last_error = '', run_after = 0, updated_at = ?
		WHERE state = 'failed'`, a.now().Unix())
	if err != nil {
		return 0, fmt.Errorf("retry failed jobs: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("retry failed jobs: %w", err)
	}
	return int(n), nil
}
