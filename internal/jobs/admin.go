package jobs

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// How many jobs of each list the administrator's page gets. More than
// that are counted, not listed: the first ones already say what goes on.
const (
	maxFailedShown = 100
	maxQueueShown  = 100
	maxRecentShown = 100
)

// recentFor is how far back the jobs that ended are listed.
const recentFor = 24 * time.Hour

// ModelDownload is the kind of the work in Overview.Active that is not a
// job of the queue: a whisper model being downloaded. It has no video.
const ModelDownload Kind = "model"

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
	Running     *JobView    `json:"running"` // the job the worker runs; null when it rests
	Failed      []JobView   `json:"failed"`  // the newest first, at most maxFailedShown
	FailedTotal int         `json:"failedTotal"`
	Kinds       []KindState `json:"kinds"`
	// Active is all the work going on now, the oldest first: the job the
	// worker runs, and a model download, which goes on at the same time.
	Active []JobView `json:"active"`
	// Queue is the jobs waiting, in the order they will run: first the
	// ones due now, then the ones waiting for a time (RunAfter) or for a
	// program FranzPLAY lacks (see Kinds). At most maxQueueShown; Waiting
	// counts them all.
	Queue []JobView `json:"queue"`
	// Recent is the jobs that ended (done or failed) in the last day, the
	// newest first, at most maxRecentShown; RecentTotal counts them all.
	Recent      []JobView   `json:"recent"`
	RecentTotal int         `json:"recentTotal"`
	Counts      []KindCount `json:"counts"` // per kind, in the order they run
}

// KindState says whether FranzPLAY can do a kind of job: it cannot when
// ffprobe or ffmpeg is missing, and those jobs wait.
type KindState struct {
	Kind      Kind `json:"kind"`
	Available bool `json:"available"`
}

// KindCount counts the jobs of one kind.
type KindCount struct {
	Kind     Kind `json:"kind"`
	Waiting  int  `json:"waiting"`
	Retrying int  `json:"retrying"`
	Running  int  `json:"running"`
	Done     int  `json:"done"`
	Failed   int  `json:"failed"`
	Recent   int  `json:"recent"` // ended in the last day, done or failed
}

// JobView is one job on the administrator's page.
type JobView struct {
	ID       int64     `json:"id"` // 0 for a ModelDownload
	Kind     Kind      `json:"kind"`
	VideoID  int64     `json:"videoId"` // 0 for a ModelDownload
	Title    string    `json:"title"`   // of the video; the model's name for a ModelDownload
	Attempts int       `json:"attempts"`
	Error    string    `json:"error"`
	At       time.Time `json:"at"` // when it started (running) or last changed

	State    string  `json:"state"`    // "pending", "running", "done", "failed"
	Cover    *string `json:"cover"`    // the video's cover; null if none yet
	Duration *int64  `json:"duration"` // of the video, in seconds; null if not known yet
	Urgent   bool    `json:"urgent"`   // someone waits for it: it runs first
	// RunAfter is, for a waiting job, the time before which it does not
	// start (a retry, a question to the internet out of hours); null: due.
	RunAfter  *time.Time `json:"runAfter"`
	StartedAt *time.Time `json:"startedAt"` // when it last started; null: never, or before this version
	EndedAt   *time.Time `json:"endedAt"`   // when it ended, done or failed
	// Seconds is how long it took (ended) or has been running.
	Seconds *float64 `json:"seconds"`
	// Stage, Progress, DoneSeconds and TotalSeconds are how far a running
	// job is, when it can tell: a transcription its stage and the seconds
	// whisper has heard, a conversion the seconds encoded, the previews
	// the frames made, a translation the sentences translated. Progress is
	// from 0 to 100; null when not known.
	// For a ModelDownload, DoneSeconds and TotalSeconds are bytes.
	Stage        string   `json:"stage"`
	Progress     *float64 `json:"progress"`
	DoneSeconds  *float64 `json:"doneSeconds"`
	TotalSeconds *float64 `json:"totalSeconds"`
}

// allKinds is every kind of job, in the order they run.
var allKinds = []Kind{Probe, Details, Online, Cover, Preview, Clip, Tracks, Translate, Transcribe, Convert}

// Live is what the queue's page learns from memory, not from the
// database: how far the running jobs are, and other work going on.
type Live struct {
	Running func() []Running // the worker's; nil: nothing known
	Others  func() []JobView // like a model download; nil: none
}

// Routes adds the queue's API for administrators to mux:
//
//	GET  /api/jobs             the Overview
//	POST /api/jobs/{id}/retry  try a failed job again
//	POST /api/jobs/retry       try every failed job again {count}
//
// wake tells the worker there is work, changed tells the open pages.
func Routes(db *sql.DB, available map[Kind]bool, live Live, wake, changed func(), logger *slog.Logger) func(mux *http.ServeMux) {
	a := admin{db: db, available: available, live: live, wake: wake, changed: changed, logger: logger,
		now: time.Now, account: users.FromContext}
	return a.routes
}

type admin struct {
	db        *sql.DB
	available map[Kind]bool
	live      Live
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
	now := a.now()
	o := Overview{Failed: []JobView{}, Active: []JobView{}, Queue: []JobView{}, Recent: []JobView{}}
	for _, k := range allKinds {
		o.Kinds = append(o.Kinds, KindState{Kind: k, Available: a.available[k]})
	}
	if o.Counts, err = a.counts(ctx, now); err != nil {
		return Overview{}, err
	}
	for _, c := range o.Counts {
		o.Waiting += c.Waiting
		o.Retrying += c.Retrying
		o.Done += c.Done
		o.FailedTotal += c.Failed
		o.RecentTotal += c.Recent
	}

	running, err := a.list(ctx, `j.state = 'running' ORDER BY j.started_ms, j.id`)
	if err != nil {
		return Overview{}, err
	}
	a.addProgress(running, now)
	if len(running) > 0 {
		o.Running = &running[0]
	}
	o.Active = append(o.Active, running...)
	if a.live.Others != nil {
		o.Active = append(o.Active, a.live.Others()...)
		slices.SortStableFunc(o.Active, func(x, y JobView) int {
			return startOf(x).Compare(startOf(y))
		})
	}

	if o.Queue, err = a.queue(ctx, now); err != nil {
		return Overview{}, err
	}
	if o.Recent, err = a.list(ctx, `j.state IN ('done', 'failed') AND j.ended_ms >= ?
		ORDER BY j.ended_ms DESC, j.id DESC LIMIT ?`, now.Add(-recentFor).UnixMilli(), maxRecentShown); err != nil {
		return Overview{}, err
	}
	if o.Failed, err = a.list(ctx, `j.state = 'failed' ORDER BY j.updated_at DESC, j.id DESC LIMIT ?`, maxFailedShown); err != nil {
		return Overview{}, err
	}
	return o, nil
}

// startOf is when a piece of work started, for sorting; the zero time
// when not known.
func startOf(j JobView) time.Time {
	if j.StartedAt == nil {
		return time.Time{}
	}
	return *j.StartedAt
}

// counts counts the jobs of each kind, in one pass over the queue.
func (a admin) counts(ctx context.Context, now time.Time) (_ []KindCount, err error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT kind,
			count(*) FILTER (WHERE state = 'pending'),
			count(*) FILTER (WHERE state = 'pending' AND attempts > 0),
			count(*) FILTER (WHERE state = 'running'),
			count(*) FILTER (WHERE state = 'done'),
			count(*) FILTER (WHERE state = 'failed'),
			count(*) FILTER (WHERE state IN ('done', 'failed') AND ended_ms >= ?)
		FROM jobs GROUP BY kind`, now.Add(-recentFor).UnixMilli())
	if err != nil {
		return nil, fmt.Errorf("count jobs: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	byKind := map[Kind]KindCount{}
	for rows.Next() {
		var c KindCount
		var kind string
		if err := rows.Scan(&kind, &c.Waiting, &c.Retrying, &c.Running, &c.Done, &c.Failed, &c.Recent); err != nil {
			return nil, fmt.Errorf("count jobs: %w", err)
		}
		c.Kind = Kind(kind)
		byKind[c.Kind] = c
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("count jobs: %w", err)
	}
	out := make([]KindCount, 0, len(allKinds))
	for _, k := range allKinds {
		c := byKind[k]
		c.Kind = k
		out = append(out, c)
	}
	return out, nil
}

// queue lists the waiting jobs in the order the worker takes them (see
// Worker.claim): first the ones due now that FranzPLAY can do, read with
// the index the worker uses, then the others, by the time they wait for.
func (a admin) queue(ctx context.Context, now time.Time) ([]JobView, error) {
	placeholders, kinds := "", []any{}
	for _, k := range allKinds {
		if !a.available[k] {
			continue
		}
		if placeholders != "" {
			placeholders += ", "
		}
		placeholders += "?"
		kinds = append(kinds, string(k))
	}
	if placeholders == "" {
		placeholders = "NULL" // matches no kind
	}
	due := append(append([]any{now.Unix()}, kinds...), maxQueueShown)
	out, err := a.listFrom(ctx, `jobs AS j INDEXED BY jobs_next`, `j.state = 'pending' AND j.run_after <= ?
		AND j.kind IN (`+placeholders+`) ORDER BY j.priority, j.id LIMIT ?`, due...)
	if err != nil || len(out) >= maxQueueShown {
		return out, err
	}
	later := append(append([]any{now.Unix()}, kinds...), maxQueueShown-len(out))
	rest, err := a.list(ctx, `j.state = 'pending' AND NOT (j.run_after <= ? AND j.kind IN (`+placeholders+`))
		ORDER BY j.run_after, j.priority, j.id LIMIT ?`, later...)
	if err != nil {
		return nil, err
	}
	for i := range rest {
		if rest[i].RunAfter != nil && !rest[i].RunAfter.After(now) {
			rest[i].RunAfter = nil // due, but FranzPLAY cannot do it: see Kinds
		}
	}
	for i := range out {
		out[i].RunAfter = nil // due now
	}
	return append(out, rest...), nil
}

// addProgress adds to the running jobs how long they have run and how
// far they are, as their handlers told the worker.
func (a admin) addProgress(running []JobView, now time.Time) {
	var live []Running
	if a.live.Running != nil {
		live = a.live.Running()
	}
	for i := range running {
		j := &running[i]
		j.EndedAt, j.Seconds = nil, nil
		for _, r := range live {
			if r.ID != j.ID {
				continue
			}
			j.StartedAt = new(r.StartedAt.UTC())
			if r.Known {
				p := r.Progress
				j.Stage = p.Stage
				if p.Percent >= 0 {
					j.Progress = new(p.Percent)
				}
				if p.Total > 0 {
					j.DoneSeconds, j.TotalSeconds = new(p.Done), new(p.Total)
				}
			}
		}
		if j.StartedAt != nil {
			j.Seconds = new(max(0, now.Sub(*j.StartedAt).Seconds()))
		}
	}
}

// list reads the jobs matching where (which also orders and limits).
func (a admin) list(ctx context.Context, where string, args ...any) ([]JobView, error) {
	return a.listFrom(ctx, `jobs AS j`, where, args...)
}

// listFrom is list, reading from the jobs table, maybe through an index.
func (a admin) listFrom(ctx context.Context, from, where string, args ...any) (_ []JobView, err error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT j.id, j.kind, j.video_id, v.shown_title, j.attempts, j.last_error, j.updated_at,
			j.state, j.urgent, j.run_after, j.started_ms, j.ended_ms, v.cover, v.duration
		FROM `+from+` JOIN videos v ON v.id = j.video_id
		WHERE `+where, args...)
	if err != nil {
		return nil, fmt.Errorf("list jobs: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := []JobView{}
	for rows.Next() {
		var j JobView
		var kind string
		var at, runAfter int64
		var started, ended, duration sql.NullInt64
		var cover sql.NullString
		if err := rows.Scan(&j.ID, &kind, &j.VideoID, &j.Title, &j.Attempts, &j.Error, &at,
			&j.State, &j.Urgent, &runAfter, &started, &ended, &cover, &duration); err != nil {
			return nil, fmt.Errorf("list jobs: %w", err)
		}
		j.Kind = Kind(kind)
		j.At = time.Unix(at, 0).UTC()
		if j.State == string(pending) && runAfter > 0 {
			j.RunAfter = new(time.Unix(runAfter, 0).UTC())
		}
		if started.Valid && j.State != string(pending) {
			j.StartedAt = new(time.UnixMilli(started.Int64).UTC())
		}
		if ended.Valid && (j.State == string(done) || j.State == string(failed)) {
			j.EndedAt = new(time.UnixMilli(ended.Int64).UTC())
			if started.Valid && ended.Int64 >= started.Int64 {
				j.Seconds = new(float64(ended.Int64-started.Int64) / 1000)
			}
		}
		if cover.Valid {
			j.Cover = new("/api/covers/" + cover.String)
		}
		if duration.Valid {
			j.Duration = new(duration.Int64)
		}
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
