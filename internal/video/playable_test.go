package video

import "testing"

func TestDirectlyPlayable(t *testing.T) {
	tests := []struct {
		ext   string
		video string
		audio string
		want  bool
	}{
		{".mp4", "h264", "aac", true},
		{".MP4", "h264", "aac", true},
		{".webm", "vp9", "opus", true},
		{".mov", "h264", "", true},
		{".mp4", "av1", "aac", true},
		{".mp4", "hevc", "aac", false}, // not in every browser
		{".mkv", "h264", "aac", false}, // container not in every browser
		{".avi", "mpeg4", "mp3", false},
		{".mp4", "h264", "ac3", false}, // surround audio most browsers cannot decode
		{".mp4", "", "", false},        // not read yet
	}
	for _, tt := range tests {
		got := DirectlyPlayable(tt.ext, Info{VideoCodec: tt.video, AudioCodec: tt.audio})
		if got != tt.want {
			t.Errorf("DirectlyPlayable(%q, %s/%s) = %v, want %v", tt.ext, tt.video, tt.audio, got, tt.want)
		}
	}
}
