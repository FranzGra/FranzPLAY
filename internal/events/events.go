// Package events tells the open pages what changed, as it happens, with
// Server-Sent Events (SSE): the browser keeps one request open and the
// server writes a short line on it whenever something changes.
//
// An event only says what changed, never the new data: the page asks for
// it again with the usual API. So a lost event costs nothing but a page
// a little behind, and nothing private travels on the stream.
package events

import (
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
)

// maxListeners is how many pages can listen at once. Each costs a
// connection and a little memory; a family never gets close.
const maxListeners = 64

// Hub hands each event to every page listening.
type Hub struct {
	mu        sync.Mutex
	listeners map[chan Kind]struct{}
	closed    bool
	done      chan struct{} // closed when FranzPLAY stops

	keepAlive, calm time.Duration // see handler.go; shorter in tests
}

// NewHub returns a hub with nobody listening.
func NewHub() *Hub {
	return &Hub{
		listeners: map[chan Kind]struct{}{},
		done:      make(chan struct{}),
		keepAlive: keepAlive,
		calm:      calm,
	}
}

// Publish tells every listener that k changed. It never waits: a
// listener that has not yet read the last event of the same kind gets
// just one, since "it changed" twice says no more than once.
func (h *Hub) Publish(k Kind) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.listeners {
		select {
		case ch <- k:
		default: // an event is already waiting for this listener
		}
	}
}

// listen adds a listener. ok is false when there are too many already or
// FranzPLAY is stopping. stop removes the listener.
func (h *Hub) listen() (events <-chan Kind, stop func(), ok bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || len(h.listeners) >= maxListeners {
		return nil, nil, false
	}
	ch := make(chan Kind, 1)
	h.listeners[ch] = struct{}{}
	return ch, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		delete(h.listeners, ch)
	}, true
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
