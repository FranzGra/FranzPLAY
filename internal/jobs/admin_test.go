package jobs

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/users"
)

// adminSite serves the queue's API for one person, with counters for the
// worker's wake and the pages' notice.
type adminSite struct {
	mux            *http.ServeMux
	who            users.Account
	woken, changed int
}

func newAdminSite(fx *fixture) *adminSite {
	s := &adminSite{mux: http.NewServeMux(), who: users.Account{ID: 1, Name: "Admin", Role: users.Admin}}
	a := admin{
		db: fx.db, available: map[Kind]bool{Probe: true, Cover: true},
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

func (s *adminSite) do(t *testing.T, method, path string, want int) []byte {
	t.Helper()
	rec := httptest.NewRecorder()
	s.mux.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	if rec.Code != want {
		t.Fatalf("%s %s = %d, want %d; body %s", method, path, rec.Code, want, rec.Body)
	}
	return rec.Body.Bytes()
}

func (s *adminSite) overview(t *testing.T) Overview {
	t.Helper()
	var o Overview
	if err := json.Unmarshal(s.do(t, "GET", "/api/jobs", http.StatusOK), &o); err != nil {
		t.Fatal(err)
	}
	return o
}

func TestOverview(t *testing.T) {
	fx := newFixture(t, 5)
	mustExec(t, fx.db, `UPDATE videos SET title = 'Mare' WHERE id = ?`, fx.videos[1])
	for _, v := range fx.videos {
		fx.enqueue(t, v, Probe)
	}
	mustExec(t, fx.db, `UPDATE jobs SET state = 'done' WHERE video_id = ?`, fx.videos[0])
	mustExec(t, fx.db, `UPDATE jobs SET state = 'failed', attempts = 3, last_error = 'broken file', updated_at = ?
		WHERE video_id = ?`, fx.clock.Unix(), fx.videos[1])
	mustExec(t, fx.db, `UPDATE jobs SET state = 'running', updated_at = ? WHERE video_id = ?`,
		fx.clock.Unix(), fx.videos[2])
	mustExec(t, fx.db, `UPDATE jobs SET attempts = 1 WHERE video_id = ?`, fx.videos[3])

	o := newAdminSite(fx).overview(t)
	if o.Waiting != 2 || o.Retrying != 1 || o.Done != 1 || o.FailedTotal != 1 {
		t.Errorf("counts = waiting %d, retrying %d, done %d, failed %d; want 2, 1, 1, 1",
			o.Waiting, o.Retrying, o.Done, o.FailedTotal)
	}
	if o.Running == nil || o.Running.VideoID != fx.videos[2] || o.Running.Kind != Probe {
		t.Errorf("running = %+v", o.Running)
	}
	if len(o.Failed) != 1 {
		t.Fatalf("failed = %+v", o.Failed)
	}
	f := o.Failed[0]
	if f.Title != "Mare" || f.Error != "broken file" || f.Attempts != 3 || !f.At.Equal(fx.clock) {
		t.Errorf("failed job = %+v", f)
	}
	want := []KindState{{Probe, true}, {Details, false}, {Online, false}, {Cover, true}, {Preview, false}, {Clip, false}, {Tracks, false}, {Transcribe, false}, {Convert, false}}
	if !slices.Equal(o.Kinds, want) {
		t.Errorf("kinds = %+v, want %+v", o.Kinds, want)
	}
}

func TestOverviewOfAnEmptyQueue(t *testing.T) {
	o := newAdminSite(newFixture(t, 0)).overview(t)
	if o.Running != nil || o.Failed == nil || len(o.Failed) != 0 || o.Waiting != 0 {
		t.Errorf("overview = %+v", o)
	}
}

func TestRetry(t *testing.T) {
	fx := newFixture(t, 3)
	for _, v := range fx.videos {
		fx.enqueue(t, v, Cover)
	}
	mustExec(t, fx.db, `UPDATE jobs SET state = 'failed', attempts = 3, last_error = 'x', run_after = 99
		WHERE video_id IN (?, ?)`, fx.videos[0], fx.videos[1])
	s := newAdminSite(fx)

	var ids []int64
	for _, f := range s.overview(t).Failed {
		ids = append(ids, f.ID)
	}
	s.do(t, "POST", "/api/jobs/"+itoa(ids[0])+"/retry", http.StatusNoContent)
	if s.woken != 1 || s.changed != 1 {
		t.Errorf("after a retry: woken %d, changed %d; want 1, 1", s.woken, s.changed)
	}
	var retried int64
	if err := fx.db.QueryRow(`SELECT video_id FROM jobs WHERE id = ?`, ids[0]).Scan(&retried); err != nil {
		t.Fatal(err)
	}
	if j := fx.job(t, retried, Cover); j.state != pending || j.attempts != 0 || j.lastError != "" {
		t.Errorf("retried job = %+v", j)
	}
	s.do(t, "POST", "/api/jobs/"+itoa(ids[0])+"/retry", http.StatusConflict) // no longer failed
	s.do(t, "POST", "/api/jobs/999/retry", http.StatusNotFound)
	s.do(t, "POST", "/api/jobs/abc/retry", http.StatusNotFound)

	var got map[string]int
	if err := json.Unmarshal(s.do(t, "POST", "/api/jobs/retry", http.StatusOK), &got); err != nil {
		t.Fatal(err)
	}
	if got["count"] != 1 {
		t.Errorf("retry all = %v, want 1", got)
	}
	if o := s.overview(t); o.FailedTotal != 0 || o.Waiting != 3 {
		t.Errorf("after retrying all: %+v", o)
	}
	// Nothing left to retry: the worker is not disturbed.
	before := s.woken
	s.do(t, "POST", "/api/jobs/retry", http.StatusOK)
	if s.woken != before {
		t.Error("worker woken with nothing to do")
	}
}

func TestQueueIsForAdministrators(t *testing.T) {
	s := newAdminSite(newFixture(t, 0))
	s.who = users.Account{ID: 2, Name: "Giulia", Role: users.User}
	for _, r := range [][2]string{{"GET", "/api/jobs"}, {"POST", "/api/jobs/1/retry"}, {"POST", "/api/jobs/retry"}} {
		s.do(t, r[0], r[1], http.StatusForbidden)
	}
	s.who = users.Account{}
	s.do(t, "GET", "/api/jobs", http.StatusUnauthorized)
}

func TestWorkerTellsWhenJobsStartAndEnd(t *testing.T) {
	fx := newFixture(t, 1)
	fx.enqueue(t, fx.videos[0], Probe)
	w := fx.worker(map[Kind]Handler{Probe: func(context.Context, int64) error { return nil }})
	n := 0
	w.OnChange(func() { n++ })
	runNext(t, w)
	if n != 2 {
		t.Errorf("changes told = %d, want 2 (start and end)", n)
	}
	runNext(t, w) // nothing to do
	if n != 2 {
		t.Errorf("changes told with an empty queue = %d", n)
	}
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
