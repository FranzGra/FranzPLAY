// Package events tells the open pages what changed, as it happens, with
// Server-Sent Events (SSE): the browser keeps one request open and the
// server writes a short line on it whenever something changes.
//
// An event only says what changed, never the new data: the page asks for
// it again with the usual API. So a lost event costs nothing but a page
// a little behind, and nothing private travels on the stream.
package events

import (
	"slices"
	"sync"
	"time"
)

// Kind is what changed. The list is closed: only these exist.
type Kind string

// The kinds of event.
const (
	// Library: the list of videos changed (a video arrived, moved or is
	// gone), or a video has new information, like its cover.
	Library Kind = "library"
	// Jobs: the queue of heavy work moved (a job started, ended or
	// failed). The administrator's page follows it.
	Jobs Kind = "jobs"
	// Scan: a check of the video folders started or ended. The
	// administrator's page follows it.
	Scan Kind = "scan"
)

// maxListeners is how many pages can listen at once. Each costs a
// connection and a little memory; a family never gets close.
const maxListeners = 64

// listener is one open page. waiting holds the kinds that changed since
// the page was last told, each once; ready says that waiting is not empty.
type listener struct {
	waiting map[Kind]bool // guarded by Hub.mu
	ready   chan struct{} // holds at most one signal
}

// Hub hands each event to every page listening.
type Hub struct {
	mu        sync.Mutex
	listeners map[*listener]struct{}
	closed    bool
	done      chan struct{} // closed when FranzPLAY stops

	keepAlive, calm time.Duration // see handler.go; shorter in tests
}

// NewHub returns a hub with nobody listening.
func NewHub() *Hub {
	return &Hub{
		listeners: map[*listener]struct{}{},
		done:      make(chan struct{}),
		keepAlive: keepAlive,
		calm:      calm,
	}
}

// Publish tells every listener that k changed. It never waits: a
// listener that has not yet been told about k gets it just once, since
// "it changed" twice says no more than once.
func (h *Hub) Publish(k Kind) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for l := range h.listeners {
		l.waiting[k] = true
		select {
		case l.ready <- struct{}{}:
		default: // already signalled
		}
	}
}

// listen adds a listener. ok is false when there are too many already or
// FranzPLAY is stopping. stop removes the listener.
func (h *Hub) listen() (l *listener, stop func(), ok bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || len(h.listeners) >= maxListeners {
		return nil, nil, false
	}
	l = &listener{waiting: map[Kind]bool{}, ready: make(chan struct{}, 1)}
	h.listeners[l] = struct{}{}
	return l, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		delete(h.listeners, l)
	}, true
}

// take returns the kinds waiting for l, in a fixed order, and forgets them.
func (h *Hub) take(l *listener) []Kind {
	h.mu.Lock()
	defer h.mu.Unlock()
	kinds := make([]Kind, 0, len(l.waiting))
	for k := range l.waiting {
		kinds = append(kinds, k)
	}
	clear(l.waiting)
	slices.Sort(kinds)
	return kinds
}

// Close ends every open stream, so the web server can stop without
// waiting for pages that would listen forever.
func (h *Hub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.closed {
		h.closed = true
		close(h.done)
	}
}
