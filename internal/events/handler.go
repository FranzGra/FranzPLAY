package events

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/respond"
)

// Timing of the stream.
const (
	// keepAlive is how often an empty comment is sent when nothing
	// happens, so routers and proxies do not close a silent connection.
	keepAlive = 30 * time.Second
	// calm is the least time between two events on a stream: while many
	// covers are being made, a page reloads its list at most this often.
	calm = 2 * time.Second
	// retry tells the browser how long to wait before connecting again
	// after the connection drops, in milliseconds.
	retry = "5000"
)

// Routes adds the event stream to mux, for logged-in people:
//
//	GET /api/events  text/event-stream: "event: library", "event: jobs"
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
			kinds := h.take(l)
			if len(kinds) == 0 {
				continue // already sent with an earlier signal
			}
			for _, k := range kinds {
				if !send("event: " + string(k) + "\ndata: {}\n\n") {
					return
				}
			}
			// Let the page breathe: further events wait (one per kind)
			// and go out together after the pause.
			select {
			case <-r.Context().Done():
				return
			case <-h.done:
				return
			case <-time.After(h.calm):
			}
		}
	}
}
