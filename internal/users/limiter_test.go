package users

import (
	"strconv"
	"testing"
	"time"
)

func TestFailuresLockAfterTooManyWrongPasswords(t *testing.T) {
	now := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	var f failures
	for i := range maxFailures - 1 {
		f = f.failed(now)
		if !f.allowed(now) {
			t.Fatalf("locked after %d failures", i+1)
		}
	}
	f = f.failed(now)
	if f.allowed(now) || f.allowed(now.Add(lockout-time.Second)) {
		t.Fatal("not locked after maxFailures")
	}
	if !f.allowed(now.Add(lockout)) {
		t.Fatal("still locked after the lockout")
	}
	// After the lockout, the count starts again.
	f = f.failed(now.Add(lockout))
	if !f.allowed(now.Add(lockout)) {
		t.Fatal("locked again after one failure")
	}
}

func TestLimiterIgnoresCaseAndForgetsOnSuccess(t *testing.T) {
	now := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	l := newLimiter()
	for range maxFailures {
		l.failed("Giulia", now)
	}
	if l.allowed("giulia", now) {
		t.Fatal("lock does not apply to the same name in other case")
	}
	if !l.allowed("Marco", now) {
		t.Fatal("lock applies to other names")
	}
	l.succeeded("GIULIA")
	if !l.allowed("Giulia", now) {
		t.Fatal("lock remains after success")
	}
}

func TestLimiterStaysSmall(t *testing.T) {
	now := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	l := newLimiter()
	for range maxFailures {
		l.failed("locked", now)
	}
	for i := range maxTracked + 10 {
		l.failed(strconv.Itoa(i), now)
	}
	if len(l.byID) > maxTracked {
		t.Fatalf("limiter tracks %d names", len(l.byID))
	}
	if l.allowed("locked", now) {
		t.Fatal("a locked name was forgotten")
	}
}
