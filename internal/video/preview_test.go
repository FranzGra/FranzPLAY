package video

import "testing"

func TestPreviewGap(t *testing.T) {
	tests := map[int64]int64{
		0: 0, 3: 0, // too short
		4: 2, 60: 2, 200: 2, // every 2 seconds
		201: 3, 600: 6, 3600: 36, 7201: 73, // 100 frames at most
	}
	for duration, want := range tests {
		got := PreviewGap(duration)
		if got != want {
			t.Errorf("PreviewGap(%d) = %d, want %d", duration, got, want)
		}
		if got > 0 && (duration+got-1)/got > MaxPreviewFrames {
			t.Errorf("PreviewGap(%d) = %d makes more than %d frames", duration, got, MaxPreviewFrames)
		}
	}
}

func TestPreviewGrid(t *testing.T) {
	tests := []struct{ count, columns, rows int }{
		{0, 0, 0}, {1, 1, 1}, {7, 7, 1}, {10, 10, 1}, {11, 10, 2}, {100, 10, 10},
	}
	for _, tt := range tests {
		if c, r := PreviewGrid(tt.count); c != tt.columns || r != tt.rows {
			t.Errorf("PreviewGrid(%d) = %d×%d, want %d×%d", tt.count, c, r, tt.columns, tt.rows)
		}
	}
}
