package online

import (
	"container/list"
	"sync"
	"time"
)

// The pictures of a search by hand come from the sources on the internet,
// up to two dozen for each search. pictureCache keeps the ones recently
// passed on, so a search asked again, by this browser or another, shows its
// pictures at once instead of downloading them all again.

// Limits of the pictures kept.
const (
	// pictureCacheBytes is the most memory the pictures take together.
	pictureCacheBytes = 64 << 20
	// pictureCacheAge is how long a picture is kept: the sources may
	// change a picture, and a search an hour old is over.
	pictureCacheAge = time.Hour
)

// pictureCache keeps at most maxBytes of pictures, each for at most maxAge,
// and forgets the least recently used first. It is safe for use by many
// requests at once.
type pictureCache struct {
	maxBytes int
	maxAge   time.Duration
	now      func() time.Time

	mu    sync.Mutex
	size  int
	order *list.List // of *keptPicture, the most recently used first
	byKey map[string]*list.Element
}

// keptPicture is one picture as it was passed on.
type keptPicture struct {
	key   string
	data  []byte
	kind  string // its Content-Type
	until time.Time
}

func newPictureCache(maxBytes int, maxAge time.Duration, now func() time.Time) *pictureCache {
	return &pictureCache{maxBytes: maxBytes, maxAge: maxAge, now: now,
		order: list.New(), byKey: map[string]*list.Element{}}
}

// get returns the picture kept for key, if there is one still young enough.
func (c *pictureCache) get(key string) (data []byte, kind string, ok bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.byKey[key]
	if !ok {
		return nil, "", false
	}
	p := e.Value.(*keptPicture)
	if !c.now().Before(p.until) {
		c.forget(e)
		return nil, "", false
	}
	c.order.MoveToFront(e)
	return p.data, p.kind, true
}

// put keeps a picture, forgetting the least recently used ones to make
// room. A picture bigger than an eighth of the whole is not kept: one
// picture alone must not push out all the others.
func (c *pictureCache) put(key string, data []byte, kind string) {
	if len(data) > c.maxBytes/8 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.byKey[key]; ok {
		c.forget(e)
	}
	c.byKey[key] = c.order.PushFront(&keptPicture{key: key, data: data, kind: kind, until: c.now().Add(c.maxAge)})
	c.size += len(data)
	for c.size > c.maxBytes {
		c.forget(c.order.Back())
	}
}

// forget drops one picture. The lock must be held.
func (c *pictureCache) forget(e *list.Element) {
	p := c.order.Remove(e).(*keptPicture)
	delete(c.byKey, p.key)
	c.size -= len(p.data)
}
