package updates

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

func TestNewer(t *testing.T) {
	for _, c := range []struct {
		installed, latest string
		want              bool
	}{
		{"1.4.0", "1.5.0", true},
		{"v1.4.0", "v1.4.1", true},
		{"1.4.0", "2.0.0", true},
		{"1.9.0", "1.10.0", true},
		{"1.5.0", "1.5.0", false},
		{"1.5.0", "1.4.9", false},
		{"1.5.0-rc.1", "1.5.0", true},
		{"1.5.0", "1.5.0-rc.1", false},
		{"1.5.0-rc.1", "1.5.0-rc.2", true},
		{"1.5.0-alpha", "1.5.0-beta", true},
		{"1.5.0+build.7", "1.5.0", false},
		{"", "1.5.0", false},        // development build
		{"1c57e51", "1.5.0", false}, // commit
		{"1.5.0", "", false},        // no release yet
		{"1.5", "1.6.0", false},
		{"01.2.3", "1.2.4", false},
	} {
		if got := Newer(c.installed, c.latest); got != c.want {
			t.Errorf("Newer(%q, %q) = %v, want %v", c.installed, c.latest, got, c.want)
		}
	}
}

func TestCleanRelease(t *testing.T) {
	for in, want := range map[string]string{"v1.2.3": "1.2.3", "1.2.3": "1.2.3", "": "", "dev": "",
		"v1.2.3-4-gabcdef": "1.2.3-4-gabcdef", "1c57e51": ""} {
		if got := CleanRelease(in); got != want {
			t.Errorf("CleanRelease(%q) = %q, want %q", in, got, want)
		}
	}
}

// setup makes a checker that talks to a pretend GitHub.
func setup(t *testing.T, release string, github http.HandlerFunc) *Checker {
	t.Helper()
	db, err := database.Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	srv := httptest.NewServer(github)
	t.Cleanup(srv.Close)
	c := New(db, release, "abc1234", slog.New(slog.NewTextHandler(io.Discard, nil)))
	c.url = srv.URL
	c.client = srv.Client()
	c.now = func() time.Time { return time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC) }
	return c
}

func TestCheckFindsANewerRelease(t *testing.T) {
	var calls atomic.Int32
	c := setup(t, "v1.4.0", func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Accept") != "application/vnd.github+json" || !strings.HasPrefix(r.Header.Get("User-Agent"), "FranzPLAY/") {
			t.Errorf("headers = %v", r.Header)
		}
		if r.Header.Get("If-None-Match") == `"x1"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", `"x1"`)
		_ = json.NewEncoder(w).Encode(map[string]any{"tag_name": "v1.5.0",
			"html_url": "https://github.com/FranzGra/FranzPLAY/releases/tag/v1.5.0",
			"body":     strings.Repeat("é", maxNotes+10)})
	})
	ctx := context.Background()
	if err := c.Check(ctx); err != nil {
		t.Fatal(err)
	}
	s, err := c.Status(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !s.Enabled || s.Release != "1.4.0" || s.Development || s.Latest != "1.5.0" || !s.Newer ||
		s.CheckedAt == nil || !strings.HasSuffix(s.URL, "/v1.5.0") {
		t.Errorf("status = %+v", s)
	}
	if n := len([]rune(s.Notes)); n != maxNotes+1 {
		t.Errorf("notes are %d characters, want %d", n, maxNotes+1)
	}
	// The second time GitHub says "nothing changed": the release stays.
	c.now = func() time.Time { return time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC) }
	if err := c.Check(ctx); err != nil {
		t.Fatal(err)
	}
	s, _ = c.Status(ctx)
	if s.Latest != "1.5.0" || s.CheckedAt.Day() != 16 || calls.Load() != 2 {
		t.Errorf("after 304: %+v, calls %d", s, calls.Load())
	}
}

func TestNoReleaseYetIsNotAnError(t *testing.T) {
	c := setup(t, "0.0.1", func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"message":"Not Found"}`, http.StatusNotFound)
	})
	if err := c.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	s, _ := c.Status(context.Background())
	if s.Latest != "" || s.Newer || s.CheckedAt == nil {
		t.Errorf("status = %+v", s)
	}
}

func TestADevelopmentBuildIsNeverToldToUpdate(t *testing.T) {
	c := setup(t, "", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"tag_name": "v9.0.0", "html_url": "u"})
	})
	if err := c.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	s, _ := c.Status(context.Background())
	if !s.Development || s.Commit != "abc1234" || s.Latest != "9.0.0" || s.Newer {
		t.Errorf("status = %+v", s)
	}
}

func TestServerErrorsKeepTheLastAnswer(t *testing.T) {
	fail := false
	c := setup(t, "1.0.0", func(w http.ResponseWriter, _ *http.Request) {
		if fail {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"tag_name": "v1.1.0", "html_url": "u"})
	})
	ctx := context.Background()
	if err := c.Check(ctx); err != nil {
		t.Fatal(err)
	}
	fail = true
	if err := c.Check(ctx); err == nil {
		t.Error("a 500 is not reported")
	}
	if s, _ := c.Status(ctx); s.Latest != "1.1.0" {
		t.Errorf("status = %+v", s)
	}
}

// fakeClock lets a test decide when the waits end.
type fakeClock struct {
	waits chan time.Duration
	fire  chan time.Time
}

func (f fakeClock) after(d time.Duration) <-chan time.Time {
	f.waits <- d
	return f.fire
}

func TestRunChecksOnScheduleAndRespectsTheSetting(t *testing.T) {
	var calls atomic.Int32
	c := setup(t, "1.0.0", func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		_ = json.NewEncoder(w).Encode(map[string]any{"tag_name": "v1.1.0", "html_url": "u"})
	})
	clock := fakeClock{waits: make(chan time.Duration), fire: make(chan time.Time)}
	c.after = clock.after
	c.jitter = func() time.Duration { return 5 * time.Second }
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { c.Run(ctx); close(done) }()

	if d := <-clock.waits; d != time.Minute+5*time.Second {
		t.Errorf("first wait = %v", d)
	}
	clock.fire <- time.Time{}
	if d := <-clock.waits; d != Interval {
		t.Errorf("next wait = %v", d)
	}
	if calls.Load() != 1 {
		t.Errorf("calls = %d, want 1", calls.Load())
	}
	// Turned off: the time comes, GitHub is not called.
	if err := c.SetEnabled(ctx, false); err != nil {
		t.Fatal(err)
	}
	clock.fire <- time.Time{}
	<-clock.waits
	if calls.Load() != 1 {
		t.Errorf("calls with the check off = %d, want 1", calls.Load())
	}
	if s, _ := c.Status(ctx); s.Enabled || s.Latest != "" || s.Newer {
		t.Errorf("status with the check off = %+v", s)
	}
	cancel()
	<-done
}

func TestRunAfterARestartWaitsForTheDayToPass(t *testing.T) {
	c := setup(t, "1.0.0", func(http.ResponseWriter, *http.Request) {})
	checked := c.now().Add(-20 * time.Hour)
	if err := c.saveLast(context.Background(), Latest{CheckedAt: checked, Version: "1.0.0"}); err != nil {
		t.Fatal(err)
	}
	clock := fakeClock{waits: make(chan time.Duration), fire: make(chan time.Time)}
	c.after = clock.after
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { c.Run(ctx); close(done) }()
	if d := <-clock.waits; d != 4*time.Hour {
		t.Errorf("first wait after a restart = %v, want 4h", d)
	}
	cancel()
	<-done
}

func TestOnlyAdministratorsSeeAndChangeIt(t *testing.T) {
	c := setup(t, "1.0.0", func(http.ResponseWriter, *http.Request) {})
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	serve := func(role users.Role, method, body string) *httptest.ResponseRecorder {
		a := api{c: c, logger: logger, account: func(context.Context) (users.Account, bool) {
			return users.Account{ID: 1, Role: role}, true
		}}
		mux := http.NewServeMux()
		a.routes(mux)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(method, "/api/updates", strings.NewReader(body)))
		return rec
	}
	if rec := serve(users.User, "GET", ""); rec.Code != http.StatusForbidden {
		t.Errorf("user GET = %d", rec.Code)
	}
	if rec := serve(users.User, "PUT", `{"enabled":false}`); rec.Code != http.StatusForbidden {
		t.Errorf("user PUT = %d", rec.Code)
	}
	if rec := serve(users.Admin, "PUT", `{}`); rec.Code != http.StatusBadRequest {
		t.Errorf("empty PUT = %d", rec.Code)
	}
	rec := serve(users.Admin, "PUT", `{"enabled":false}`)
	var s Status
	if err := json.Unmarshal(rec.Body.Bytes(), &s); err != nil || rec.Code != http.StatusOK || s.Enabled {
		t.Errorf("PUT = %d %s", rec.Code, rec.Body)
	}
	rec = serve(users.Admin, "GET", "")
	if err := json.Unmarshal(rec.Body.Bytes(), &s); err != nil || s.Enabled || s.Release != "1.0.0" {
		t.Errorf("GET = %d %s", rec.Code, rec.Body)
	}
}
