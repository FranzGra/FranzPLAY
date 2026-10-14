package progress

import (
	"errors"
	"math"
	"testing"
)

func TestMark(t *testing.T) {
	tests := []struct {
		name     string
		position float64
		duration int64
		want     Mark
	}{
		{"just started", 5, 600, Mark{}},
		{"watching", 125.7, 600, Mark{Position: 125}},
		{"credits of a long film", 7080, 7200, Mark{Finished: true}}, // 2% of 2 h is 144 s
		{"long film, before the credits", 7000, 7200, Mark{Position: 7000}},
		{"last 30 seconds", 575, 600, Mark{Finished: true}},
		{"just before the end", 560, 600, Mark{Position: 560}},
		{"short clip, started", 3, 20, Mark{Position: 3}}, // a tenth of 20 s is 2 s
		{"short clip, end", 19, 20, Mark{Finished: true}},
		{"duration unknown", 42, 0, Mark{Position: 42}},
		{"past the end", 700, 600, Mark{Finished: true}},
	}
	for _, tt := range tests {
		got, err := Decide(tt.position, tt.duration)
		if err != nil || got != tt.want {
			t.Errorf("%s: mark(%v, %d) = %+v, %v; want %+v", tt.name, tt.position, tt.duration, got, err, tt.want)
		}
	}
}

func TestMarkRejectsNonsense(t *testing.T) {
	for _, p := range []float64{-1, math.NaN(), math.Inf(1), maxPosition + 1} {
		if _, err := Decide(p, 600); !errors.Is(err, errBadPosition) {
			t.Errorf("mark(%v): err = %v", p, err)
		}
	}
}
