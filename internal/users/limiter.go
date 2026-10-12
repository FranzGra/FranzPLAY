package users

import (
	"strings"
	"sync"
	"time"
)

// Wrong passwords slow down whoever is guessing: after maxFailures wrong
// tries on the same name, that name must wait lockout before trying again.
const (
	maxFailures = 5
	lockout     = time.Minute
)

// maxTracked bounds the memory the limiter uses when someone tries many
// different names: past it, records that do not lock anybody are forgotten.
const maxTracked = 10000

// failures is the record of wrong passwords for one name.
type failures struct {
	count int
	until time.Time // locked until this time
}

// allowed decides whether a login may be tried now. Pure: easy to test.
func (f failures) allowed(now time.Time) bool {
	return !now.Before(f.until)
}

// failed returns the record after one more wrong password.
func (f failures) failed(now time.Time) failures {
	f.count++
	if f.count >= maxFailures {
		return failures{count: 0, until: now.Add(lockout)}
	}
	return f
}

// limiter remembers wrong passwords per name, in memory only: after a
// restart everybody starts again from zero, which is fine.
type limiter struct {
	mu   sync.Mutex
	byID map[string]failures
}

func newLimiter() *limiter { return &limiter{byID: map[string]failures{}} }

func (l *limiter) allowed(name string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.byID[strings.ToLower(name)].allowed(now)
}

func (l *limiter) failed(name string, now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	key := strings.ToLower(name)
	if _, known := l.byID[key]; !known && len(l.byID) >= maxTracked {
		for k, f := range l.byID {
			if f.allowed(now) {
				delete(l.byID, k)
			}
		}
	}
	l.byID[key] = l.byID[key].failed(now)
}

func (l *limiter) succeeded(name string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.byID, strings.ToLower(name))
}
