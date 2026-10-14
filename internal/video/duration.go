// Package video holds the core types that describe a video.
//
// Everything in this package is pure: no disk, no database, no clock.
// That keeps it fast and easy to test.
package video

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// maxSeconds is the longest duration we accept: about 68 years.
// Anything above it is certainly a broken value, not a real video.
const maxSeconds = math.MaxInt32

// ErrInvalidDuration is returned when a duration is negative, too long or unreadable.
var ErrInvalidDuration = errors.New("invalid duration")

// Duration is the length of a video, stored as whole seconds.
//
// The old FranzPLAY stored durations as text like "1:30", which could mean
// 1 hour 30 minutes or 1 minute 30 seconds depending on who read it.
// A number of seconds has only one meaning; the text form exists only for display.
//
// The zero value is a valid duration of 0 seconds (for example a video not yet probed).
type Duration struct {
	seconds int64
}

// NewDuration builds a Duration from a number of seconds.
// It rejects negative and unreasonably long values.
func NewDuration(seconds int64) (Duration, error) {
	if seconds < 0 || seconds > maxSeconds {
		return Duration{}, fmt.Errorf("%w: %d seconds", ErrInvalidDuration, seconds)
	}
	return Duration{seconds: seconds}, nil
}

// ParseProbeDuration reads the duration printed by ffprobe, such as "5400.123000",
// and rounds it to the nearest second.
//
// Values like "", "N/A", "NaN", "Inf" or negative numbers are rejected,
// so a broken file can never turn into a wrong duration.
func ParseProbeDuration(s string) (Duration, error) {
	s = strings.TrimSpace(s)
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
		return Duration{}, fmt.Errorf("%w: %q", ErrInvalidDuration, s)
	}
	rounded := math.Round(f)
	if rounded < 0 || rounded > maxSeconds {
		return Duration{}, fmt.Errorf("%w: %q", ErrInvalidDuration, s)
	}
	return Duration{seconds: int64(rounded)}, nil
}

// Seconds returns the duration as a whole number of seconds.
func (d Duration) Seconds() int64 {
	return d.seconds
}

// String formats the duration the way YouTube does:
// "0:05", "4:05", "59:59", "1:00:00", "1:30:00".
func (d Duration) String() string {
	h := d.seconds / 3600
	m := (d.seconds % 3600) / 60
	s := d.seconds % 60
	if h > 0 {
		return fmt.Sprintf("%d:%02d:%02d", h, m, s)
	}
	return fmt.Sprintf("%d:%02d", m, s)
}
