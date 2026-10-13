package video

import "testing"

func TestDirectlyPlayable(t *testing.T) {
	tests := []struct {
		ext    string
		video  string
		pixels string
		audio  string
		want   bool
	}{
		{".mp4", "h264", "yuv420p", "aac", true},
		{".MP4", "h264", "yuv420p", "aac", true},
		{".mov", "h264", "yuvj420p", "", true},        // full-range colours, as some cameras make
		{".m4v", "h264", "", "mp3", true},             // pixels not read yet: almost every H.264 is plain
		{".mp4", "h264", "yuv420p10le", "aac", false}, // 10-bit H.264 plays almost nowhere
		{".mp4", "h264", "yuv444p", "aac", false},
		{".webm", "vp9", "yuv420p", "opus", false}, // no .webm on older iPhones
		{".mp4", "av1", "yuv420p", "aac", false},   // AV1 only on the newest Apple devices
		{".mp4", "vp9", "yuv420p", "aac", false},
		{".mp4", "hevc", "yuv420p", "aac", false},  // not in every browser
		{".mp4", "h264", "yuv420p", "opus", false}, // Opus in MP4: not on older Safari
		{".mp4", "h264", "yuv420p", "flac", false},
		{".mkv", "h264", "yuv420p", "aac", false}, // Safari opens no .mkv
		{".avi", "mpeg4", "yuv420p", "mp3", false},
		{".mp4", "h264", "yuv420p", "ac3", false}, // surround audio most browsers cannot decode
		{".mp4", "", "", "", false},               // not read yet
	}
	for _, tt := range tests {
		got := DirectlyPlayable(tt.ext, Info{VideoCodec: tt.video, PixelFormat: tt.pixels, AudioCodec: tt.audio})
		if got != tt.want {
			t.Errorf("DirectlyPlayable(%q, %s %s/%s) = %v, want %v", tt.ext, tt.video, tt.pixels, tt.audio, got, tt.want)
		}
	}
}

func TestCopyAudioToMP4(t *testing.T) {
	for codec, want := range map[string]bool{"aac": true, "mp3": true, "opus": false, "flac": false, "ac3": false, "dts": false, "vorbis": false, "": false} {
		if got := CopyAudioToMP4(codec); got != want {
			t.Errorf("CopyAudioToMP4(%q) = %v, want %v", codec, got, want)
		}
	}
}
