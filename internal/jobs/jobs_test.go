package jobs

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"slices"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/database"
)

var t0 = time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)

func TestAfterFailure(t *testing.T) {
	temporary := errors.New("disk busy")
	permanent := fmt.Errorf("not a video: %w", ErrPermanent)
	tests := []struct {
		name      string
		attempts  int
		err       error
		wantState state
		wantAfter time.Time
	}{
		{"first failure: retry in 5 minutes", 1, temporary, pending, t0.Add(5 * time.Minute)},
		{"second failure: retry in 10 minutes", 2, temporary, pending, t0.Add(10 * time.Minute)},
		{"third failure: give up", MaxAttempts, temporary, failed, t0},
		{"permanent failure: give up at once", 1, permanent, failed, t0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, after := afterFailure(tt.attempts, tt.err, t0)
			if s != tt.wantState || !after.Equal(tt.wantAfter) {
				t.Errorf("afterFailure() = %s, %v; want %s, %v", s, after, tt.wantState, tt.wantAfter)
			}
		})
	}
}

// fixture is a database with a few videos and a worker with a fake clock.
type fixture struct {
	db     *sql.DB
	clock  time.Time
	videos []int64
}

func newFixture(t *testing.T, videos int) *fixture {
	t.Helper()
	db, err := database.Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	fx := &fixture{db: db, clock: t0}
	mustExec(t, db, `INSERT INTO libraries (id, path) VALUES (1, '/videos')`)
	for i := range videos {
		res := mustExec(t, db, `INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, added_at)
			VALUES (?, 1, ?, 1, 1, 't', 1)`, fmt.Sprint("fp", i), fmt.Sprint("v", i, ".mp4"))
		id, err := res.LastInsertId()
		if err != nil {
			t.Fatal(err)
		}
		fx.videos = append(fx.videos, id)
	}
	return fx
}

func mustExec(t *testing.T, db *sql.DB, query string, args ...any) sql.Result {
	t.Helper()
	res, err := db.Exec(query, args...)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func (fx *fixture) worker(handlers map[Kind]Handler) *Worker {
	w := NewWorker(fx.db, handlers, slog.New(slog.NewTextHandler(io.Discard, nil)))
	w.now = func() time.Time { return fx.clock }
	return w
}

func (fx *fixture) enqueue(t *testing.T, videoID int64, kind Kind) {
	t.Helper()
	if err := Enqueue(context.Background(), fx.db, videoID, kind, false, fx.clock); err != nil {
		t.Fatal(err)
	}
}

type jobRow struct {
	state     state
	attempts  int
	lastError string
}

func (fx *fixture) job(t *testing.T, videoID int64, kind Kind) jobRow {
	t.Helper()
	var r jobRow
	var s string
	err := fx.db.QueryRow(`SELECT state, attempts, last_error FROM jobs WHERE video_id = ? AND kind = ?`,
		videoID, string(kind)).Scan(&s, &r.attempts, &r.lastError)
	if err != nil {
		t.Fatal(err)
	}
	r.state = state(s)
	return r
}

func runNext(t *testing.T, w *Worker) bool {
	t.Helper()
	ran, err := w.RunNext(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return ran
}

func TestWorkerRunsAJob(t *testing.T) {
	fx := newFixture(t, 1)
	video := fx.videos[0]
	fx.enqueue(t, video, Probe)
	var got []int64
	w := fx.worker(map[Kind]Handler{Probe: func(_ context.Context, id int64) error {
		got = append(got, id)
		return nil
	}})

	if !runNext(t, w) {
		t.Fatal("no job ran")
	}
	if len(got) != 1 || got[0] != video {
		t.Errorf("handler called with %v, want [%d]", got, video)
	}
	if j := fx.job(t, video, Probe); j.state != done {
		t.Errorf("job = %+v, want done", j)
	}
	if runNext(t, w) {
		t.Error("a finished job ran again")
	}
}

func TestWorkerRetriesThenGivesUp(t *testing.T) {
	fx := newFixture(t, 1)
	video := fx.videos[0]
	fx.enqueue(t, video, Probe)
	calls := 0
	w := fx.worker(map[Kind]Handler{Probe: func(context.Context, int64) error {
		calls++
		return errors.New("disk busy")
	}})

	runNext(t, w)
	if j := fx.job(t, video, Probe); j.state != pending || j.attempts != 1 || j.lastError != "disk busy" {
		t.Fatalf("after one failure: %+v", j)
	}
	if runNext(t, w) {
		t.Fatal("job retried before its waiting time")
	}
	fx.clock = fx.clock.Add(retryDelay(1))
	runNext(t, w)
	fx.clock = fx.clock.Add(retryDelay(2))
	runNext(t, w)

	if j := fx.job(t, video, Probe); j.state != failed || j.attempts != MaxAttempts {
		t.Errorf("after %d failures: %+v, want failed", MaxAttempts, j)
	}
	if calls != MaxAttempts {
		t.Errorf("handler called %d times, want %d", calls, MaxAttempts)
	}
}

func TestWorkerPermanentFailure(t *testing.T) {
	fx := newFixture(t, 1)
	fx.enqueue(t, fx.videos[0], Probe)
	w := fx.worker(map[Kind]Handler{Probe: func(context.Context, int64) error {
		return fmt.Errorf("audio only: %w", ErrPermanent)
	}})
	runNext(t, w)
	if j := fx.job(t, fx.videos[0], Probe); j.state != failed || j.attempts != 1 {
		t.Errorf("job = %+v, want failed after one attempt", j)
	}
}

func TestWorkerPostponesAJobNotDueYet(t *testing.T) {
	fx := newFixture(t, 1)
	video := fx.videos[0]
	fx.enqueue(t, video, Online)
	calls := 0
	w := fx.worker(map[Kind]Handler{Online: func(context.Context, int64) error {
		calls++
		if calls == 1 {
			return fmt.Errorf("asking: %w", &LaterError{Until: fx.clock.Add(time.Hour)})
		}
		return nil
	}})

	runNext(t, w)
	if j := fx.job(t, video, Online); j.state != pending || j.attempts != 0 || j.lastError != "" {
		t.Fatalf("postponed job = %+v, want pending with no failed attempt", j)
	}
	fx.clock = fx.clock.Add(59 * time.Minute)
	if runNext(t, w) {
		t.Fatal("the job ran before its time")
	}
	fx.clock = fx.clock.Add(time.Minute)
	if !runNext(t, w) || fx.job(t, video, Online).state != done {
		t.Errorf("at its time the job did not run: %+v", fx.job(t, video, Online))
	}
}

func TestWorkerRunsTheKindsInOrder(t *testing.T) {
	fx := newFixture(t, 7)
	fx.enqueue(t, fx.videos[5], Details)
	fx.enqueue(t, fx.videos[4], Convert)
	fx.enqueue(t, fx.videos[6], Transcribe)
	fx.enqueue(t, fx.videos[3], Tracks)
	fx.enqueue(t, fx.videos[0], Preview)
	fx.enqueue(t, fx.videos[1], Cover)
	fx.enqueue(t, fx.videos[2], Probe)
	var order []Kind
	record := func(k Kind) Handler {
		return func(context.Context, int64) error { order = append(order, k); return nil }
	}
	w := fx.worker(map[Kind]Handler{Probe: record(Probe), Details: record(Details), Cover: record(Cover),
		Preview: record(Preview), Tracks: record(Tracks), Transcribe: record(Transcribe), Convert: record(Convert)})
	for runNext(t, w) {
	}
	if want := []Kind{Probe, Details, Cover, Preview, Tracks, Transcribe, Convert}; !slices.Equal(order, want) {
		t.Errorf("order = %v, want %v", order, want)
	}
}

func TestConversionGivesWayToOtherWork(t *testing.T) {
	fx := newFixture(t, 2)
	film, fresh := fx.videos[0], fx.videos[1]
	fx.enqueue(t, film, Convert)
	var order []string
	w := fx.worker(nil)
	w.handlers = map[Kind]Handler{
		Convert: func(ctx context.Context, _ int64) error {
			order = append(order, "convert")
			if len(order) > 1 {
				return nil // the second time it ends
			}
			// A new video arrives while the film is being converted.
			fx.enqueue(t, fresh, Probe)
			w.Wake()
			<-ctx.Done() // ffmpeg would be killed here
			return ctx.Err()
		},
		Probe: func(context.Context, int64) error { order = append(order, "probe"); return nil },
	}

	runNext(t, w)
	if j := fx.job(t, film, Convert); j.state != pending || j.attempts != 0 || j.lastError != "" {
		t.Fatalf("conversion that gave way = %+v, want pending with no failed attempt", j)
	}
	for runNext(t, w) {
	}
	if want := []string{"convert", "probe", "convert"}; !slices.Equal(order, want) {
		t.Errorf("order = %v, want %v", order, want)
	}
	if j := fx.job(t, film, Convert); j.state != done {
		t.Errorf("conversion = %+v, want done", j)
	}
}

func TestConversionDoesNotGiveWayToItsOwnKind(t *testing.T) {
	fx := newFixture(t, 2)
	fx.enqueue(t, fx.videos[0], Convert)
	w := fx.worker(nil)
	w.handlers = map[Kind]Handler{Convert: func(ctx context.Context, id int64) error {
		if id == fx.videos[0] {
			fx.enqueue(t, fx.videos[1], Convert)
			w.Wake()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(200 * time.Millisecond):
			}
		}
		return nil
	}}
	runNext(t, w)
	if j := fx.job(t, fx.videos[0], Convert); j.state != done {
		t.Errorf("first conversion = %+v, want done: another conversion is no reason to stop", j)
	}
}

func TestTimeouts(t *testing.T) {
	if Convert.timeout() < 12*time.Hour || Transcribe.timeout() < 12*time.Hour || Cover.timeout() > time.Hour {
		t.Errorf("timeouts: convert %v, cover %v", Convert.timeout(), Cover.timeout())
	}
}

func TestWorkerLeavesKindsItCannotDo(t *testing.T) {
	fx := newFixture(t, 1)
	fx.enqueue(t, fx.videos[0], Cover)
	w := fx.worker(map[Kind]Handler{Probe: func(context.Context, int64) error { return nil }})
	if runNext(t, w) {
		t.Error("worker ran a job it has no handler for")
	}
	if j := fx.job(t, fx.videos[0], Cover); j.state != pending {
		t.Errorf("job = %+v, want still pending", j)
	}
}

func TestInterruptedJobRunsAgainAfterRestart(t *testing.T) {
	fx := newFixture(t, 1)
	video := fx.videos[0]
	fx.enqueue(t, video, Probe)

	// FranzPLAY stops while the job is running.
	ctx, cancel := context.WithCancel(context.Background())
	w := fx.worker(map[Kind]Handler{Probe: func(context.Context, int64) error {
		cancel()
		return context.Canceled
	}})
	if _, err := w.RunNext(ctx); err != nil {
		t.Fatal(err)
	}
	if j := fx.job(t, video, Probe); j.state != running || j.attempts != 0 {
		t.Fatalf("interrupted job = %+v, want running with no failed attempt", j)
	}

	// At the next start it goes back in the queue and runs.
	ran := false
	w = fx.worker(map[Kind]Handler{Probe: func(context.Context, int64) error { ran = true; return nil }})
	if err := w.resetInterrupted(context.Background()); err != nil {
		t.Fatal(err)
	}
	runNext(t, w)
	if !ran {
		t.Error("interrupted job did not run again")
	}
}

func TestEnqueueAgainWhileRunningRunsOnNewContent(t *testing.T) {
	fx := newFixture(t, 1)
	video := fx.videos[0]
	fx.enqueue(t, video, Probe)
	calls := 0
	w := fx.worker(map[Kind]Handler{Probe: func(context.Context, int64) error {
		calls++
		if calls == 1 {
			// The file is replaced while the job runs.
			fx.enqueue(t, video, Probe)
		}
		return nil
	}})
	runNext(t, w)
	if j := fx.job(t, video, Probe); j.state != pending {
		t.Fatalf("job = %+v, want pending again", j)
	}
	runNext(t, w)
	if calls != 2 {
		t.Errorf("handler called %d times, want 2", calls)
	}
}

func TestEnqueueOnlyIfNotDone(t *testing.T) {
	fx := newFixture(t, 1)
	video := fx.videos[0]
	fx.enqueue(t, video, Probe)
	w := fx.worker(map[Kind]Handler{Probe: func(context.Context, int64) error { return nil }})
	runNext(t, w)

	if err := Enqueue(context.Background(), fx.db, video, Probe, true, fx.clock); err != nil {
		t.Fatal(err)
	}
	if j := fx.job(t, video, Probe); j.state != done {
		t.Errorf("job = %+v, want still done", j)
	}
	fx.enqueue(t, video, Probe)
	if j := fx.job(t, video, Probe); j.state != pending {
		t.Errorf("job = %+v, want pending", j)
	}
}

func TestJobsGoAwayWithTheirVideo(t *testing.T) {
	fx := newFixture(t, 1)
	fx.enqueue(t, fx.videos[0], Probe)
	mustExec(t, fx.db, `DELETE FROM videos WHERE id = ?`, fx.videos[0])
	var n int
	if err := fx.db.QueryRow(`SELECT count(*) FROM jobs`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("%d jobs left for a deleted video", n)
	}
}
