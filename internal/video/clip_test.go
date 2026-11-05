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

func TestClipPlanParts(t *testing.T) {
	tests := []struct {
		name     string
		plan     ClipPlan
		duration int64
		want     []ClipPart
		tag      string
	}{
		{"automatic as always", AutoClip, 600, []ClipPart{{150, 2}, {300, 2}, {450, 2}}, ""},
		{"automatic, longer", ClipPlan{Second: -1, Seconds: 10}, 600, []ClipPart{{150, 4}, {300, 3}, {450, 3}}, "a10"},
		{"automatic, short video", ClipPlan{Second: -1, Seconds: 10}, 20, []ClipPart{{2, 10}}, "a10"},
		{"chosen second", ClipPlan{Second: 42, Seconds: 5}, 600, []ClipPart{{42, 5}}, "s42-5"},
		{"chosen second 0", ClipPlan{Second: 0}, 600, []ClipPart{{0, 6}}, "s0-6"},
		{"chosen near the end", ClipPlan{Second: 598, Seconds: 6}, 600, []ClipPart{{594, 6}}, "s598-6"},
		{"video shorter than the clip", ClipPlan{Second: 3, Seconds: 30}, 12, []ClipPart{{0, 12}}, "s3-30"},
		{"site percent", ClipPlan{Second: -1, Percent: 10, Seconds: 8}, 600, []ClipPart{{60, 8}}, "p10-8"},
		{"site percent, short video", ClipPlan{Second: -1, Percent: 95, Seconds: 8}, 20, []ClipPart{{12, 8}}, "p95-8"},
		{"chosen second beats the site", ClipPlan{Second: 7, Percent: 50, Seconds: 4}, 600, []ClipPart{{7, 4}}, "s7-4"},
		{"length kept in bounds", ClipPlan{Second: 10, Seconds: 99}, 600, []ClipPart{{10, 30}}, "s10-30"},
		{"too short for any", ClipPlan{Second: 1, Seconds: 6}, 3, nil, "s1-6"},
	}
	for _, tt := range tests {
		got := tt.plan.Parts(tt.duration)
		if !slices.Equal(got, tt.want) {
			t.Errorf("%s: Parts(%d) = %v, want %v", tt.name, tt.duration, got, tt.want)
		}
		for _, p := range got {
			if p.Length <= 0 || p.Start < 0 || p.Start+p.Length > tt.duration {
				t.Errorf("%s: part %v is outside the video", tt.name, p)
			}
		}
		if tag := tt.plan.Tag(); tag != tt.tag {
			t.Errorf("%s: Tag() = %q, want %q", tt.name, tag, tt.tag)
		}
	}
}
