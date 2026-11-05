package events

import (
	"bufio"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"runtime"
	"sync"
	"testing"
	"time"
)

// goroutinesBackTo waits until no more than want goroutines run, or fails.
// A stream that ended may need a moment to return.
func goroutinesBackTo(t *testing.T, want int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		got := runtime.NumGoroutine()
		if got <= want {
			return
		}
		if time.Now().After(deadline) {
			buf := make([]byte, 1<<16)
			t.Fatalf("%d goroutines still running, want at most %d:\n%s", got, want, buf[:runtime.Stack(buf, true)])
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// page is one open page, with its own connection, that can go away.
type page struct {
	cancel context.CancelFunc
	lines  chan string
}

func open(t *testing.T, client *http.Client, url string) *page {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url+"/api/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := client.Do(req) //nolint:bodyclose // closed by the goroutine that reads it, below
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		cancel()
		t.Fatalf("open: %d", resp.StatusCode)
	}
	p := &page{cancel: cancel, lines: make(chan string, 100)}
	go func() {
		defer close(p.lines)
		defer func() { _ = resp.Body.Close() }()
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			p.lines <- sc.Text()
		}
	}()
	return p
}

// Pages that go away (a closed tab, a phone that lost the network) give
// their place back, and leave no goroutine behind.
func TestPagesThatGoAwayLeaveNothingBehind(t *testing.T) {
	before := runtime.NumGoroutine()
	func() {
		h := NewHub()
		h.keepAlive, h.calm, h.jobsCalm = time.Hour, 20*time.Millisecond, 10*time.Millisecond
		mux := http.NewServeMux()
		h.Routes(slog.New(slog.NewTextHandler(io.Discard, nil)))(mux)
		srv := httptest.NewServer(mux)
		defer srv.Close()
		defer h.Close()
		transport := &http.Transport{}
		defer transport.CloseIdleConnections()
		client := &http.Client{Transport: transport}

		for round := range 3 {
			pages := make([]*page, maxListeners)
			for i := range pages {
				pages[i] = open(t, client, srv.URL)
				if got := next(t, pages[i].lines); got != "retry: 5000" {
					t.Fatalf("round %d page %d: first line %q", round, i, got)
				}
			}
			waitListeners(t, h, maxListeners)
			h.Publish(Library)
			for i, p := range pages {
				if got := next(t, p.lines); got != "event: library" {
					t.Fatalf("round %d page %d: %q, want the event", round, i, got)
				}
			}
			for _, p := range pages {
				p.cancel()
			}
			for _, p := range pages {
				for range p.lines { // until the reader ends
				}
			}
			waitListeners(t, h, 0)
		}
	}()
	// The test's own helpers may keep one or two goroutines a moment.
	goroutinesBackTo(t, before+2)
}

// A page that stops reading does not slow the others, nor Publish: a
// listener holds at most one signal, whatever happens.
func TestPublishNeverWaits(t *testing.T) {
	h := NewHub()
	stuck, stopStuck, ok := h.listen()
	if !ok {
		t.Fatal("cannot listen")
	}
	defer stopStuck()
	done := make(chan struct{})
	go func() {
		defer close(done)
		for range 100_000 {
			h.Publish(Library)
			h.Publish(Jobs)
		}
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Publish waited for a page that does not read")
	}
	if len(stuck.ready) != 1 {
		t.Errorf("signals waiting = %d, want 1", len(stuck.ready))
	}
	if got := h.take(stuck); len(got) != 2 || got[0] != Jobs || got[1] != Library {
		t.Errorf("waiting = %v, want jobs and library once each", got)
	}
	if got := h.take(stuck); len(got) != 0 {
		t.Errorf("after taking: %v, want nothing", got)
	}
}

// Pages come and go while events are published from several places:
// the race detector watches, and every page still listening hears.
func TestListenersComeAndGoWhilePublishing(t *testing.T) {
	h := NewHub()
	stop := make(chan struct{})
	var publishers sync.WaitGroup
	for _, k := range []Kind{Library, Jobs, Scan} {
		publishers.Go(func() {
			for {
				select {
				case <-stop:
					return
				default:
					h.Publish(k)
				}
			}
		})
	}
	var pages sync.WaitGroup
	for range 16 {
		pages.Go(func() {
			for range 200 {
				l, leave, ok := h.listen()
				if !ok {
					continue // full for a moment: try again
				}
				<-l.ready
				if len(h.take(l)) == 0 {
					// A signal can arrive after its kinds were taken
					// by an earlier read; never with nothing at all
					// on the first one.
					t.Error("a page was woken with nothing to tell")
				}
				leave()
			}
		})
	}
	pages.Wait()
	close(stop)
	publishers.Wait()
	h.mu.Lock()
	left := len(h.listeners)
	h.mu.Unlock()
	if left != 0 {
		t.Errorf("listeners left = %d, want 0", left)
	}
}

// Closing twice is harmless, and Publish after Close neither panics nor
// waits.
func TestCloseTwice(t *testing.T) {
	h := NewHub()
	l, _, ok := h.listen()
	if !ok {
		t.Fatal("cannot listen")
	}
	h.Close()
	h.Close()
	h.Publish(Scan)
	if got := h.take(l); len(got) != 1 || got[0] != Scan {
		t.Errorf("a page still open hears %v: its stream ends on done, not here", got)
	}
}

// BenchmarkPublish is one change told to a full house of pages.
func BenchmarkPublish(b *testing.B) {
	h := NewHub()
	var ls []*listener
	for range maxListeners {
		l, _, ok := h.listen()
		if !ok {
			b.Fatal("cannot listen")
		}
		ls = append(ls, l)
	}
	for b.Loop() {
		h.Publish(Library)
		for _, l := range ls {
			<-l.ready
			h.take(l)
		}
	}
}
