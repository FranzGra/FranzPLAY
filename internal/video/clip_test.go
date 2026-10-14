package video

import (
	"slices"
	"testing"
)

func TestClipParts(t *testing.T) {
	tests := []struct {
		duration int64
		want     []ClipPart
	}{
		{0, nil},
		{3, nil}, // too short to need a clip
		{4, []ClipPart{{0, 4}}},
		{10, []ClipPart{{1, 6}}},
		{29, []ClipPart{{2, 6}}},
		{30, []ClipPart{{7, 2}, {15, 2}, {22, 2}}},
		{600, []ClipPart{{150, 2}, {300, 2}, {450, 2}}},
		{7200, []ClipPart{{1800, 2}, {3600, 2}, {5400, 2}}},
	}
	for _, tt := range tests {
		got := ClipParts(tt.duration)
		if !slices.Equal(got, tt.want) {
			t.Errorf("ClipParts(%d) = %v, want %v", tt.duration, got, tt.want)
		}
		for _, p := range got {
			if p.Length <= 0 || p.Start < 0 || p.Start+p.Length > tt.duration {
				t.Errorf("ClipParts(%d): part %v is outside the video", tt.duration, p)
			}
		}
	}
}
