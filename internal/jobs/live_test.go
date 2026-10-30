package jobs

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/users"
)

// TestWorkerFollowsProgress: while a job runs, what its handler reports
// is in Running, and the pages hear of it at most once a second, or
// when the stage changes; when it ends it is gone, and its times saved.
func TestWorkerFollowsProgress(t *testing.T) {
	fx := newFixture(t, 1)
	fx.enqueue(t, fx.videos[0], Cover)
	var w *Worker
	var during []Running
	w = fx.worker(map[Kind]Handler{Cover: func(ctx context.Context, _ int64) error {
		Report(ctx, Progress{Stage: "transcribe", Percent: 10, Done: 6, Total: 60})
		Report(ctx, Progress{Stage: "transcribe", Percent: 20, Done: 12, Total: 60}) // same second: not told
		during = w.Running()
		fx.clock = fx.clock.Add(1500 * time.Millisecond)
		Report(ctx, Progress{Stage: "transcribe", Percent: 150, Done: 60, Total: 60}) // a second later: told
		Report(ctx, Progress{Stage: "translate", Percent: -1})                        // new stage: told
		return nil
	}})
	n := 0
	w.OnChange(func() { n++ })
	started := fx.clock
	runNext(t, w)

	if len(during) != 1 {
		t.Fatalf("running during the job: %+v", during)
	}
	r := during[0]
	if r.VideoID != fx.videos[0] || r.Kind != Cover || !r.StartedAt.Equal(started) || !r.Known ||
		r.Progress != (Progress{Stage: "transcribe", Percent: 20, Done: 12, Total: 60}) {
		t.Errorf("running = %+v", r)
	}
	if n != 5 { // start, 10%, 100%, translate, end
		t.Errorf("pages told %d times, want 5", n)
	}
	if left := w.Running(); len(left) != 0 {
		t.Errorf("still running after the end: %+v", left)
	}
	var startedMS, endedMS int64
	if err := fx.db.QueryRow(`SELECT started_ms, ended_ms FROM jobs`).Scan(&startedMS, &endedMS); err != nil {
		t.Fatal(err)
	}
	if startedMS != started.UnixMilli() || endedMS != started.Add(1500*time.Millisecond).UnixMilli() {
		t.Errorf("times saved %d → %d, want %d → %d", startedMS, endedMS, started.UnixMilli(),
			started.Add(1500*time.Millisecond).UnixMilli())
	}
}

func TestReportOutsideAJobDoesNothing(t *testing.T) {
	Report(context.Background(), Progress{Percent: 50}) // no panic
}

func newAdminSiteWith(fx *fixture, live Live, available map[Kind]bool) *adminSite {
	s := &adminSite{mux: http.NewServeMux(), who: users.Account{ID: 1, Name: "Admin", Role: users.Admin}}
	a := admin{
		db: fx.db, available: available, live: live,
		wake: func() { s.woken++ }, changed: func() { s.changed++ },
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		now:    func() time.Time { return fx.clock },
		account: func(context.Context) (users.Account, bool) {
			return s.who, s.who.ID != 0
		},
	}
	a.routes(s.mux)
	return s
}

// TestOverviewListsActiveQueueAndRecent: the page gets the work going on
// with how far it is, the queue in the order it runs, and what ended in
// the last day with how long it took.
func TestOverviewListsActiveQueueAndRecent(t *testing.T) {
	fx := newFixture(t, 8)
	v := fx.videos
	mustExec(t, fx.db, `UPDATE videos SET duration = 600, cover = 'c.jpg', title = 'Film' WHERE id = ?`, v[0])
	now := fx.clock.UnixMilli()
	for _, j := range []struct {
		video int64
		kind  Kind
		set   string
		args  []any
	}{
		{v[0], Transcribe, `state = 'running', started_ms = ?`, []any{now - 30_000}},
		{v[1], Cover, ``, nil},
		{v[2], Probe, ``, nil},
		{v[3], Cover, `urgent = 1`, nil},
		{v[4], Convert, ``, nil}, // FranzPLAY cannot do it here
		{v[5], Cover, `attempts = 1, run_after = ?`, []any{fx.clock.Add(time.Hour).Unix()}}, // tries again later
		{v[6], Probe, `state = 'done', started_ms = ?, ended_ms = ?`, []any{now - 5000, now - 2500}},
		{v[7], Cover, `state = 'failed', attempts = 3, last_error = 'broken', started_ms = ?, ended_ms = ?`,
			[]any{now - 9000, now - 8000}},
	} {
		fx.enqueue(t, j.video, j.kind)
		if j.set != "" {
			mustExec(t, fx.db, `UPDATE jobs SET `+j.set+` WHERE video_id = ?`, append(j.args, j.video)...)
		}
	}
	fx.enqueue(t, v[6], Cover) // done two days ago: not recent
	mustExec(t, fx.db, `UPDATE jobs SET state = 'done', started_ms = ?, ended_ms = ? WHERE video_id = ? AND kind = 'cover'`,
		now-48*3600_000, now-48*3600_000+10, v[6])

	var jobID int64
	if err := fx.db.QueryRow(`SELECT id FROM jobs WHERE kind = 'transcribe'`).Scan(&jobID); err != nil {
		t.Fatal(err)
	}
	download := JobView{Kind: ModelDownload, Title: "base", State: "running",
		StartedAt: new(fx.clock.Add(-10 * time.Second)), Progress: new(25.0)}
	live := Live{
		Running: func() []Running {
			return []Running{{ID: jobID, VideoID: v[0], Kind: Transcribe, StartedAt: fx.clock.Add(-30 * time.Second),
				Known: true, Progress: Progress{Stage: "transcribe", Percent: 42, Done: 252, Total: 600}}}
		},
		Others: func() []JobView { return []JobView{download} },
	}
	o := newAdminSiteWith(fx, live, map[Kind]bool{Probe: true, Cover: true, Transcribe: true}).overview(t)

	if len(o.Active) != 2 || o.Active[0].Kind != Transcribe || o.Active[1].Kind != ModelDownload {
		t.Fatalf("active = %+v, want the transcription then the download", o.Active)
	}
	a := o.Active[0]
	if a.Title != "Film" || a.Cover == nil || *a.Cover != "/api/covers/c.jpg" || a.Duration == nil || *a.Duration != 600 ||
		a.Stage != "transcribe" || a.Progress == nil || *a.Progress != 42 || *a.DoneSeconds != 252 ||
		*a.TotalSeconds != 600 || a.Seconds == nil || *a.Seconds != 30 || a.State != "running" {
		t.Errorf("transcription = %+v", a)
	}
	if o.Running == nil || o.Running.ID != jobID {
		t.Errorf("running = %+v, want the transcription", o.Running)
	}

	var queue []int64
	for _, j := range o.Queue {
		queue = append(queue, j.VideoID)
	}
	// Urgent first, then by kind (probe before cover), then what cannot
	// run now: the conversion (no ffmpeg here), the retry in an hour.
	if want := []int64{v[3], v[2], v[1], v[4], v[5]}; !slices.Equal(queue, want) {
		t.Errorf("queue = %v, want %v", queue, want)
	}
	if q := o.Queue; !q[0].Urgent || q[3].RunAfter != nil || q[4].RunAfter == nil ||
		!q[4].RunAfter.Equal(fx.clock.Add(time.Hour)) || q[1].StartedAt != nil {
		t.Errorf("queue details = %+v", q)
	}
	if o.Waiting != 5 || o.Retrying != 1 {
		t.Errorf("waiting %d, retrying %d; want 5, 1", o.Waiting, o.Retrying)
	}

	if len(o.Recent) != 2 || o.RecentTotal != 2 {
		t.Fatalf("recent = %+v (total %d), want the probe then the failed cover", o.Recent, o.RecentTotal)
	}
	if r := o.Recent[0]; r.Kind != Probe || r.State != "done" || r.Seconds == nil || *r.Seconds != 2.5 ||
		r.EndedAt == nil || !r.EndedAt.Equal(fx.clock.Add(-2500*time.Millisecond)) {
		t.Errorf("recent probe = %+v", r)
	}
	if r := o.Recent[1]; r.Kind != Cover || r.State != "failed" || r.Error != "broken" || *r.Seconds != 1 {
		t.Errorf("recent failure = %+v", r)
	}
	if len(o.Failed) != 1 || o.Failed[0].VideoID != v[7] {
		t.Errorf("failed = %+v", o.Failed)
	}

	counts := map[Kind]KindCount{}
	for _, c := range o.Counts {
		counts[c.Kind] = c
	}
	if c := counts[Cover]; c.Waiting != 3 || c.Retrying != 1 || c.Failed != 1 || c.Done != 1 || c.Recent != 1 {
		t.Errorf("cover counts = %+v", c)
	}
	if c := counts[Transcribe]; c.Running != 1 {
		t.Errorf("transcribe counts = %+v", c)
	}
	if len(o.Counts) != len(allKinds) {
		t.Errorf("counts for %d kinds, want %d", len(o.Counts), len(allKinds))
	}
}
