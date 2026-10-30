package events

import (
	"log/slog"
	"net/http"
	"slices"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/respond"
)

// Timing of the stream.
const (
	// keepAlive is how often an empty comment is sent when nothing
	// happens, so routers and proxies do not close a silent connection.
	keepAlive = 30 * time.Second
	// calm is the least time between two events of the same kind on a
	// stream: while many covers are being made, a page reloads its list at
	// most this often.
	calm = 2 * time.Second
	// jobsCalm is calm for the queue of work: its bars of progress move
	// smoothly, and a page asks for the queue (one small answer) at most
	// twice a second.
	jobsCalm = 500 * time.Millisecond
	// retry tells the browser how long to wait before connecting again
	// after the connection drops, in milliseconds.
	retry = "5000"
)

// Routes adds the event stream to mux, for logged-in people:
//
//	GET /api/events  text/event-stream: "event: library", "jobs", "scan"
func (h *Hub) Routes(logger *slog.Logger) func(mux *http.ServeMux) {
	return func(mux *http.ServeMux) {
		mux.HandleFunc("GET /api/events", func(w http.ResponseWriter, r *http.Request) {
			h.serve(w, r, logger)
		})
	}
}

func (h *Hub) serve(w http.ResponseWriter, r *http.Request, logger *slog.Logger) {
	l, stop, ok := h.listen()
	if !ok {
		respond.Error(w, r, logger, http.StatusServiceUnavailable, "too many open pages, try again later")
		return
	}
	defer stop()

	rc := http.NewResponseController(w)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no") // tell nginx not to hold the lines back
	w.WriteHeader(http.StatusOK)
	send := func(text string) bool {
		if _, err := w.Write([]byte(text)); err != nil {
			return false // the page went away
		}
		return rc.Flush() == nil
	}
	if !send("retry: " + retry + "\n\n") {
		return
	}

	ping := time.NewTicker(h.keepAlive)
	defer ping.Stop()

	// Each kind keeps its own pause: a change waits in pending until the
	// last event of its kind is calm old, then goes out.
	last := map[Kind]time.Time{}
	pending := map[Kind]bool{}
	var wake <-chan time.Time
	flush := func() bool {
		now := time.Now()
		var soonest time.Duration
		for _, k := range sortedKinds(pending) {
			wait := h.calmFor(k) - now.Sub(last[k])
			if _, told := last[k]; !told || wait <= 0 {
				if !send("event: " + string(k) + "\ndata: {}\n\n") {
					return false
				}
				last[k] = now
				delete(pending, k)
				continue
			}
			if soonest == 0 || wait < soonest {
				soonest = wait
			}
		}
		wake = nil
		if soonest > 0 {
			wake = time.After(soonest)
		}
		return true
	}
	for {
		select {
		case <-r.Context().Done():
			return
		case <-h.done:
			return
		case <-ping.C:
			if !send(": ping\n\n") {
				return
			}
		case <-l.ready:
			for _, k := range h.take(l) {
				pending[k] = true
			}
			if !flush() {
				return
			}
		case <-wake:
			if !flush() {
				return
			}
		}
	}
}

// calmFor is the least time between two events of kind k on a stream.
func (h *Hub) calmFor(k Kind) time.Duration {
	if k == Jobs {
		return h.jobsCalm
	}
	return h.calm
}

// sortedKinds returns the kinds in set, in a fixed order.
func sortedKinds(set map[Kind]bool) []Kind {
	kinds := make([]Kind, 0, len(set))
	for k := range set {
		kinds = append(kinds, k)
	}
	slices.Sort(kinds)
	return kinds
}
