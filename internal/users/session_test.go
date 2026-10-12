package users

import (
	"testing"
	"time"
)

func TestNeedsTouch(t *testing.T) {
	last := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		after time.Duration
		want  bool
	}{
		{0, false},
		{59 * time.Minute, false},
		{time.Hour, true},
		{48 * time.Hour, true},
	} {
		if got := needsTouch(last, last.Add(tc.after)); got != tc.want {
			t.Errorf("needsTouch after %v = %v, want %v", tc.after, got, tc.want)
		}
	}
}

func TestNewTokenIsRandomAndHashed(t *testing.T) {
	a, hashA, err := newToken()
	if err != nil {
		t.Fatal(err)
	}
	b, _, err := newToken()
	if err != nil {
		t.Fatal(err)
	}
	if a == b || len(a) != 43 {
		t.Fatalf("tokens %q and %q", a, b)
	}
	if string(hashA) != string(hashToken(a)) || string(hashA) == a {
		t.Fatal("stored hash does not match the token")
	}
}
