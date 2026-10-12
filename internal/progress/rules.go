// Package progress remembers where each person stopped in each video, for
// "Continua a guardare".
package progress

import (
	"errors"
	"math"
)

// maxPosition is the latest position accepted: a week, far past any video.
const maxPosition = 7 * 24 * 60 * 60

// errBadPosition means the position sent is not a time in a video.
var errBadPosition = errors.New("the position must be a number of seconds from 0")

// Mark is what is remembered of one person and one video.
type Mark struct {
	Position int64 `json:"position"` // seconds; 0 = from the start
	Finished bool  `json:"finished"`
}

// Decide decides what to remember from the position the player sent.
// duration is the video's length in seconds, 0 when not known yet.
//
//   - Just started (the first 10 seconds, or the first tenth of a short
//     video): nothing to continue, the video starts from the beginning.
//   - Near the end (the last 30 seconds, or the last tenth of a short
//     video, or the last 2% of a long one, often credits): finished.
//   - Otherwise: continue from there.
func Decide(position float64, duration int64) (Mark, error) {
	if math.IsNaN(position) || math.IsInf(position, 0) || position < 0 || position > maxPosition {
		return Mark{}, errBadPosition
	}
	seconds := int64(position)
	if duration <= 0 {
		return Mark{Position: seconds}, nil
	}
	d := float64(duration)
	startedAfter := math.Min(10, d*0.1)
	nearEnd := math.Max(math.Min(30, d*0.1), d*0.02)
	switch {
	case position >= d-nearEnd:
		return Mark{Finished: true}, nil
	case position < startedAfter:
		return Mark{}, nil
	default:
		return Mark{Position: seconds}, nil
	}
}
