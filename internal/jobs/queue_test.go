package jobs

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/database"
)

// waitFor is how long a test waits for the worker before it gives up. It is
// far below idleCheck: a job seen in time was found because the worker was
// woken, not because it looked again by itself.
const waitFor = 10 * time.Second

func receiveN(t *testing.T, ch <-chan int64, n int) []int64 {
	t.Helper()
	var got []int64
	timeout := time.After(waitFor)
	for len(got) < n {
		select {
		case id := <-ch:
			got = append(got, id)
		case <-timeout:
			t.Fatalf("worker ran %v, want %d jobs", got, n)
		}
	}
	return got
}

// startRun runs w until the returned function is called; that function
// returns once Run has ended.
func startRun(t *testing.T, w *Worker) (stop func()) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		w.Run(ctx)
	}()
	return func() {
		cancel()
		select {
		case <-stopped:
		case <-time.After(waitFor):
			t.Fatal("Run did not end after its context was cancelled")
		}
	}
}

// TestRunWorksThroughTheQueueUntilStopped: at start Run puts back the job a
// crash left running, does every job due, takes a new one as soon as it is
// woken, and ends when FranzPLAY stops.
func TestRunWorksThroughTheQueueUntilStopped(t *testing.T) {
	fx := newFixture(t, 3)
	crashed, waiting, later := fx.videos[0], fx.videos[1], fx.videos[2]
	fx.enqueue(t, crashed, Probe)
	mustExec(t, fx.db, `UPDATE jobs SET state = 'running' WHERE video_id = ?`, crashed)
	fx.enqueue(t, waiting, Probe)

	ended := make(chan int64, 8)
	w := fx.worker(map[Kind]Handler{Probe: func(context.Context, int64) error { return nil }})
	w.OnJobDone(func(_ context.Context, id int64) { ended <- id })
	stop := startRun(t, w)

	got := receiveN(t, ended, 2)
	if (got[0] != crashed || got[1] != waiting) && (got[0] != waiting || got[1] != crashed) {
		t.Errorf("ran %v, want videos %d and %d", got, crashed, waiting)
	}
	fx.enqueue(t, later, Probe)
	w.Wake()
	if got := receiveN(t, ended, 1); got[0] != later {
		t.Errorf("after Wake ran video %d, want %d", got[0], later)
	}
	stop()

	if j := fx.job(t, crashed, Probe); j.state != done || j.attempts != 1 {
		t.Errorf("job left running by a crash = %+v, want done after one failed attempt", j)
	}
	for _, id := range fx.videos {
		if j := fx.job(t, id, Probe); j.state != done {
			t.Errorf("video %d: job = %+v, want done", id, j)
		}
	}
}

// TestRunStopsDuringAJobAndGivesItBack: a job running when FranzPLAY stops
// is not lost and not counted as failed.
func TestRunStopsDuringAJobAndGivesItBack(t *testing.T) {
	fx := newFixture(t, 1)
	video := fx.videos[0]
	fx.enqueue(t, video, Convert)
	started := make(chan struct{})
	w := fx.worker(map[Kind]Handler{Convert: func(ctx context.Context, _ int64) error {
		close(started)
		<-ctx.Done() // ffmpeg would be killed here
		return ctx.Err()
	}})
	stop := startRun(t, w)
	select {
	case <-started:
	case <-time.After(waitFor):
		t.Fatal("the job did not start")
	}
	stop()
	if j := fx.job(t, video, Convert); j.state != pending || j.attempts != 0 || j.lastError != "" {
		t.Errorf("job = %+v, want back in the queue with no failed attempt", j)
	}
}

func TestWakeNeverBlocks(t *testing.T) {
	fx := newFixture(t, 0)
	w := fx.worker(nil)
	var wg sync.WaitGroup
	for range 50 {
		wg.Go(func() {
			for range 100 {
				w.Wake()
			}
		})
	}
	finished := make(chan struct{})
	go func() { wg.Wait(); close(finished) }()
	select {
	case <-finished:
	case <-time.After(waitFor):
		t.Fatal("Wake blocked with nobody reading")
	}
}

func TestJobAskedTwiceWhileWaitingRunsOnce(t *testing.T) {
	fx := newFixture(t, 1)
	video := fx.videos[0]
	for range 3 {
		fx.enqueue(t, video, Cover)
	}
	var n int
	if err := fx.db.QueryRow(`SELECT count(*) FROM jobs WHERE video_id = ?`, video).Scan(&n); err != nil || n != 1 {
		t.Fatalf("rows = %d, %v; want 1", n, err)
	}
	calls := 0
	w := fx.worker(map[Kind]Handler{Cover: func(context.Context, int64) error { calls++; return nil }})
	for runNext(t, w) {
	}
	if calls != 1 {
		t.Errorf("handler called %d times, want 1", calls)
	}
}

// TestNoJobLostOrRunTwiceUnderLoad: jobs asked from many goroutines while the
// worker runs (as the scanner, the pages and the uploads do) all end, one at
// a time, and none is saved as done more often than it was asked for.
func TestNoJobLostOrRunTwiceUnderLoad(t *testing.T) {
	fx := newFixture(t, 20)
	kinds := []Kind{Probe, Cover, Preview, Clip}

	var running, most atomic.Int32
	handler := func(context.Context, int64) error {
		n := running.Add(1)
		defer running.Add(-1)
		for {
			m := most.Load()
			if n <= m || most.CompareAndSwap(m, n) {
				break
			}
		}
		return nil
	}
	handlers := map[Kind]Handler{}
	for _, k := range kinds {
		handlers[k] = handler
	}
	type key struct {
		video int64
		kind  Kind
	}
	var mu sync.Mutex
	asked := map[key]int{}
	completed := map[key]int{}
	w := fx.worker(handlers)
	// OnJobDone only says the video: completions are counted per video.
	w.OnJobDone(func(_ context.Context, id int64) {
		mu.Lock()
		defer mu.Unlock()
		completed[key{video: id}]++
	})
	stop := startRun(t, w)

	var wg sync.WaitGroup
	for g := range 8 {
		wg.Go(func() {
			for i := range 30 {
				k := key{fx.videos[(g*7+i)%len(fx.videos)], kinds[(g+i)%len(kinds)]}
				if err := Enqueue(context.Background(), fx.db, k.video, k.kind, false, fx.clock); err != nil {
					t.Error(err)
					return
				}
				mu.Lock()
				asked[k]++
				mu.Unlock()
				w.Wake()
			}
		})
	}
	wg.Wait()
	stop()
	// FranzPLAY starts again: what Run left is done here, one by one. A job
	// stopped while it was being saved is put back as at every start (see
	// TestJobEndingWhileFranzPLAYStopsIsNotACrash).
	if err := w.resetInterrupted(context.Background()); err != nil {
		t.Fatal(err)
	}
	for runNext(t, w) {
	}

	if m := most.Load(); m != 1 {
		t.Errorf("%d jobs ran at the same time, want 1", m)
	}
	perVideo := map[int64]int{}
	for k, n := range asked {
		if j := fx.job(t, k.video, k.kind); j.state != done {
			t.Errorf("video %d %s: job = %+v, want done", k.video, k.kind, j)
		}
		perVideo[k.video] += n
	}
	var pending int
	if err := fx.db.QueryRow(`SELECT count(*) FROM jobs WHERE state != 'done'`).Scan(&pending); err != nil || pending != 0 {
		t.Errorf("jobs not done = %d, %v", pending, err)
	}
	for video, n := range perVideo {
		if c := completed[key{video: video}]; c < 1 || c > n {
			t.Errorf("video %d: done %d times, asked %d times", video, c, n)
		}
	}
}

// TestJobEndingWhileFranzPLAYStopsIsNotACrash: a job that succeeded just as
// FranzPLAY is stopping cleanly must be saved as done, or at least given
// back, never left "running" to be counted as a crash at the next start.
func TestJobEndingWhileFranzPLAYStopsIsNotACrash(t *testing.T) {
	fx := newFixture(t, 1)
	video := fx.videos[0]
	fx.enqueue(t, video, Probe)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	returned := false
	w := fx.worker(map[Kind]Handler{Probe: func(context.Context, int64) error {
		returned = true
		return nil
	}})
	// FranzPLAY is told to stop right after the job ended, before it is saved.
	w.now = func() time.Time {
		if returned {
			cancel()
		}
		return fx.clock
	}
	_, _ = w.RunNext(ctx)
	if j := fx.job(t, video, Probe); j.state == running {
		t.Fatalf("job = %+v: left running, the next start will count a crash", j)
	}
}

// TestJobsPutFirstAtOnceKeepTheirOrder: many jobs put first in the same
// millisecond, from several goroutines, each get their own place.
func TestJobsPutFirstAtOnceKeepTheirOrder(t *testing.T) {
	fx := newFixture(t, 30)
	for _, id := range fx.videos {
		fx.enqueue(t, id, Preview)
	}
	var wg sync.WaitGroup
	for _, id := range fx.videos {
		wg.Go(func() {
			if _, err := Hurry(context.Background(), fx.db, id, Preview, fx.clock); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()

	rows, err := fx.db.Query(`SELECT video_id, urgent_at FROM jobs ORDER BY urgent_at DESC`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close() //nolint:errcheck // read-only query
	var want []int64
	seen := map[int64]bool{}
	for rows.Next() {
		var video, at int64
		if err := rows.Scan(&video, &at); err != nil {
			t.Fatal(err)
		}
		if seen[at] {
			t.Errorf("two jobs put first with urgent_at %d", at)
		}
		seen[at] = true
		want = append(want, video)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}

	var order []int64
	w := fx.worker(map[Kind]Handler{Preview: func(_ context.Context, id int64) error {
		order = append(order, id)
		return nil
	}})
	for runNext(t, w) {
	}
	if fmt.Sprint(order) != fmt.Sprint(want) {
		t.Errorf("order = %v, want the last put first first: %v", order, want)
	}
}

// TestPostponedJobWaitsItsTime: a job not due yet is not taken before its
// time, and is taken right after.
func TestPostponedJobWaitsItsTime(t *testing.T) {
	fx := newFixture(t, 1)
	video := fx.videos[0]
	fx.enqueue(t, video, Online)
	calls := 0
	w := fx.worker(map[Kind]Handler{Online: func(context.Context, int64) error {
		calls++
		if calls == 1 {
			return &LaterError{Until: fx.clock.Add(time.Hour)}
		}
		return nil
	}})
	runNext(t, w)
	fx.clock = fx.clock.Add(time.Hour - time.Second)
	if runNext(t, w) {
		t.Fatal("a postponed job ran before its time")
	}
	fx.clock = fx.clock.Add(time.Second)
	if !runNext(t, w) || calls != 2 {
		t.Fatalf("calls = %d, want the job to run at its time", calls)
	}
	if j := fx.job(t, video, Online); j.state != done || j.attempts != 0 {
		t.Errorf("job = %+v, want done without failed attempts", j)
	}
}

// TestFailedJobWaitsBeforeTryingAgain: a failure is tried again only after
// retryDelay, and a job waiting for that does not block the others.
func TestFailedJobWaitsBeforeTryingAgain(t *testing.T) {
	fx := newFixture(t, 2)
	bad, good := fx.videos[0], fx.videos[1]
	fx.enqueue(t, bad, Probe)
	var order []int64
	w := fx.worker(map[Kind]Handler{Probe: func(_ context.Context, id int64) error {
		order = append(order, id)
		if id == bad {
			return errors.New("disk busy")
		}
		return nil
	}})
	runNext(t, w)
	fx.enqueue(t, good, Probe)
	runNext(t, w)
	if runNext(t, w) {
		t.Fatal("a failed job was tried again at once")
	}
	fx.clock = fx.clock.Add(retryDelay(1))
	runNext(t, w)
	if fmt.Sprint(order) != fmt.Sprint([]int64{bad, good, bad}) {
		t.Errorf("order = %v", order)
	}
}

// BenchmarkEnqueue measures asking for a job again, as a scan does for
// every changed file.
func BenchmarkEnqueue(b *testing.B) {
	db := openBench(b)
	fillQueue(b, db, 1000)
	ctx := context.Background()
	var i int64
	for b.Loop() {
		i++
		if err := Enqueue(ctx, db, 1+i%1000, Cover, false, t0); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkRunNext measures the queue's own work around one job: picking
// it, marking it running and saving it done, with 10,000 videos waiting.
func BenchmarkRunNext(b *testing.B) {
	db := openBench(b)
	fillQueue(b, db, 10000)
	fx := &fixture{db: db, clock: t0}
	noop := func(context.Context, int64) error { return nil }
	w := fx.worker(map[Kind]Handler{Probe: noop, Cover: noop, Preview: noop, Clip: noop, Convert: noop})
	ctx := context.Background()
	for b.Loop() {
		ran, err := w.RunNext(ctx)
		if err != nil || !ran {
			b.Fatalf("ran %v, %v", ran, err)
		}
	}
}

func openBench(b *testing.B) *sql.DB {
	b.Helper()
	db, err := database.Open(context.Background(), b.TempDir())
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = db.Close() })
	return db
}
