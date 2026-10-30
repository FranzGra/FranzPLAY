package events

import (
	"bufio"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func newTestHub(t *testing.T) (*Hub, *httptest.Server) {
	t.Helper()
	h := NewHub()
	h.keepAlive, h.calm, h.jobsCalm = time.Hour, 300*time.Millisecond, 50*time.Millisecond
	mux := http.NewServeMux()
	h.Routes(slog.New(slog.NewTextHandler(io.Discard, nil)))(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(func() {
		h.Close()
		srv.Close()
	})
	return h, srv
}

// stream opens the event stream and returns its headers and its lines,
// one at a time. The body is closed when the test ends.
func stream(t *testing.T, srv *httptest.Server) (http.Header, <-chan string) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/api/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })
	lines := make(chan string, 100)
	go func() {
		defer close(lines)
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			lines <- sc.Text()
		}
	}()
	return resp.Header, lines
}

// next returns the next line that is not empty, or fails after a while.
func next(t *testing.T, lines <-chan string) string {
	t.Helper()
	for {
		select {
		case line, ok := <-lines:
			if !ok {
				return "(stream closed)"
			}
			if line != "" {
				return line
			}
		case <-time.After(2 * time.Second):
			t.Fatal("no line from the stream")
		}
	}
}

// waitListeners waits until n pages are listening.
func waitListeners(t *testing.T, h *Hub, n int) {
	t.Helper()
	for range 200 {
		h.mu.Lock()
		got := len(h.listeners)
		h.mu.Unlock()
		if got == n {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("listeners never reached %d", n)
}

func TestStream(t *testing.T) {
	h, srv := newTestHub(t)
	header, lines := stream(t, srv)
	if ct := header.Get("Content-Type"); ct != "text/event-stream" {
		t.Errorf("Content-Type = %q", ct)
	}
	if got := next(t, lines); got != "retry: 5000" {
		t.Errorf("first line = %q", got)
	}
	waitListeners(t, h, 1)

	h.Publish(Library)
	if got := next(t, lines); got != "event: library" {
		t.Errorf("event line = %q", got)
	}
	if got := next(t, lines); got != "data: {}" {
		t.Errorf("data line = %q", got)
	}
}

func TestManyChangesBecomeOneEvent(t *testing.T) {
	h, srv := newTestHub(t)
	_, lines := stream(t, srv)
	next(t, lines) // retry
	waitListeners(t, h, 1)

	h.Publish(Library)
	next(t, lines) // event: library
	next(t, lines) // data
	// While the page is given its pause, many covers get ready.
	for range 50 {
		h.Publish(Library)
	}
	if got := next(t, lines); got != "event: library" {
		t.Fatalf("after the pause = %q", got)
	}
	next(t, lines)
	select {
	case line := <-lines:
		if strings.HasPrefix(line, "event:") {
			t.Errorf("a second event for the same changes: %q", line)
		}
	case <-time.After(200 * time.Millisecond):
	}
}

func TestDifferentChangesAreAllTold(t *testing.T) {
	h, srv := newTestHub(t)
	_, lines := stream(t, srv)
	next(t, lines) // retry
	waitListeners(t, h, 1)

	h.Publish(Library)
	next(t, lines) // event: library
	next(t, lines) // data
	// During the pause, both kinds change: neither may be lost.
	h.Publish(Jobs)
	h.Publish(Library)
	h.Publish(Jobs)
	got := []string{next(t, lines), next(t, lines), next(t, lines), next(t, lines)}
	want := []string{"event: jobs", "data: {}", "event: library", "data: {}"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("after the pause = %q, want %q", got, want)
	}
}

func TestJobsHaveAShorterPause(t *testing.T) {
	h, srv := newTestHub(t)
	_, lines := stream(t, srv)
	next(t, lines) // retry
	waitListeners(t, h, 1)

	h.Publish(Library)
	h.Publish(Jobs)
	// Both go out at once the first time, in a fixed order.
	got := []string{next(t, lines), next(t, lines), next(t, lines), next(t, lines)}
	want := []string{"event: jobs", "data: {}", "event: library", "data: {}"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("first events = %q, want %q", got, want)
	}
	// Now both change again: the queue's bars move after the short pause,
	// the list of videos waits for the long one.
	start := time.Now()
	h.Publish(Library)
	h.Publish(Jobs)
	if got := next(t, lines); got != "event: jobs" {
		t.Fatalf("after the short pause = %q, want the jobs", got)
	}
	jobsAfter := time.Since(start)
	next(t, lines) // data
	if got := next(t, lines); got != "event: library" {
		t.Fatalf("after the long pause = %q, want the library", got)
	}
	libraryAfter := time.Since(start)
	if jobsAfter >= 250*time.Millisecond {
		t.Errorf("jobs waited %v, want about the short pause (50ms)", jobsAfter)
	}
	if libraryAfter < 250*time.Millisecond {
		t.Errorf("library waited %v, want about the long pause (300ms)", libraryAfter)
	}
}

func TestJobsAtMostOncePerPause(t *testing.T) {
	h, srv := newTestHub(t)
	_, lines := stream(t, srv)
	next(t, lines) // retry
	waitListeners(t, h, 1)

	// The queue moves every 5ms for 400ms: the page hears of it about
	// once every 50ms, never at every move.
	stop := time.After(400 * time.Millisecond)
	tick := time.NewTicker(5 * time.Millisecond)
	defer tick.Stop()
	go func() {
		for {
			select {
			case <-stop:
				return
			case <-tick.C:
				h.Publish(Jobs)
			}
		}
	}()
	events := 0
	deadline := time.After(500 * time.Millisecond)
	for done := false; !done; {
		select {
		case line := <-lines:
			if line == "event: jobs" {
				events++
			}
		case <-deadline:
			done = true
		}
	}
	if events < 3 || events > 12 {
		t.Errorf("%d jobs events in 500ms, want about 8 (one every 50ms)", events)
	}
}

func TestClosingEndsTheStreams(t *testing.T) {
	h, srv := newTestHub(t)
	_, lines := stream(t, srv)
	next(t, lines)
	waitListeners(t, h, 1)
	h.Close()
	if got := next(t, lines); got != "(stream closed)" {
		t.Errorf("after Close: %q, want the stream closed", got)
	}
	waitListeners(t, h, 0)
	if _, _, ok := h.listen(); ok {
		t.Error("a new page could listen after Close")
	}
}

func TestTooManyPages(t *testing.T) {
	h := NewHub()
	for range maxListeners {
		if _, _, ok := h.listen(); !ok {
			t.Fatal("refused before the limit")
		}
	}
	if _, _, ok := h.listen(); ok {
		t.Error("accepted past the limit")
	}
}
