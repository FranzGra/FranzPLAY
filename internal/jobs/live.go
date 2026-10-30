package jobs

import (
	"context"
	"slices"
	"sync"
	"time"
)

// Progress is how far a running job is, as its handler tells it with
// Report. It lives in memory only: after a restart the job starts again
// from the beginning anyway.
type Progress struct {
	// Stage is what the job does now, for jobs made of steps: a
	// transcription is "audio" or "transcribe", a translation "translate".
	// "" otherwise.
	Stage string
	// Percent is from 0 to 100; negative when the job cannot tell.
	Percent float64
	// Done and Total are the seconds of the video handled so far and in
	// all: what whisper has heard, how far ffmpeg has encoded; for a
	// translation the sentences. 0 = not known.
	Done, Total float64
}

// Running is a job running now, as the administrator's page shows it.
type Running struct {
	ID        int64
	VideoID   int64
	Kind      Kind
	StartedAt time.Time
	Progress  Progress
	Known     bool // Progress was reported at least once
}

// reportEvery is the least time between two notices to the pages for
// the progress of one job: often enough to see it move, rarely enough
// that nobody reloads the page for nothing.
const reportEvery = time.Second

// live holds the jobs running now and how far they are.
type live struct {
	mu      sync.Mutex
	jobs    map[int64]*liveJob
	changed func() // tells the pages; set by the worker
	now     func() time.Time
}

type liveJob struct {
	Running
	told time.Time // when the pages were last told about it
}

func newLive(now func() time.Time) *live {
	return &live{jobs: map[int64]*liveJob{}, changed: func() {}, now: now}
}

// begin adds a job that starts, and returns the context its handler runs
// with, through which it reports how far it is.
func (l *live) begin(ctx context.Context, j job, started time.Time) context.Context {
	l.mu.Lock()
	l.jobs[j.id] = &liveJob{Running: Running{ID: j.id, VideoID: j.videoID, Kind: j.kind, StartedAt: started,
		Progress: Progress{Percent: -1}}}
	l.mu.Unlock()
	return WithReporter(ctx, func(p Progress) { l.report(j.id, p) })
}

// end forgets a job that ended.
func (l *live) end(id int64) {
	l.mu.Lock()
	delete(l.jobs, id)
	l.mu.Unlock()
}

// report saves how far a job is and tells the pages, at most once every
// reportEvery, unless the stage changed.
func (l *live) report(id int64, p Progress) {
	l.mu.Lock()
	j, ok := l.jobs[id]
	tell := false
	if ok {
		now := l.now()
		stageChanged := j.Progress.Stage != p.Stage
		if p.Percent > 100 {
			p.Percent = 100
		}
		j.Progress, j.Known = p, true
		if stageChanged || now.Sub(j.told) >= reportEvery {
			j.told, tell = now, true
		}
	}
	changed := l.changed
	l.mu.Unlock()
	if tell {
		changed()
	}
}

// running returns the jobs running now, the oldest first.
func (l *live) running() []Running {
	l.mu.Lock()
	out := make([]Running, 0, len(l.jobs))
	for _, j := range l.jobs {
		out = append(out, j.Running)
	}
	l.mu.Unlock()
	slices.SortFunc(out, func(a, b Running) int { return a.StartedAt.Compare(b.StartedAt) })
	return out
}

type reporterKey struct{}

// reporter receives the progress of one job.
type reporter func(Progress)

// Report tells how far the job running with ctx is. Outside a job, like
// in most tests, it does nothing.
func Report(ctx context.Context, p Progress) {
	if r, ok := ctx.Value(reporterKey{}).(reporter); ok {
		r(p)
	}
}

// WithReporter returns a context whose Report calls f: the worker's for
// each job, and the tests'.
func WithReporter(ctx context.Context, f func(Progress)) context.Context {
	return context.WithValue(ctx, reporterKey{}, reporter(f))
}
