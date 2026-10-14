package video

import "testing"

func TestPlanConversion(t *testing.T) {
	tests := []struct {
		ext, video, pixels, audio string
		want                      ConvertPlan
	}{
		{".mp4", "h264", "yuv420p", "aac", ConvertPlan{}},                              // plays as it is
		{".mp4", "", "", "", ConvertPlan{}},                                            // not read yet
		{".mkv", "h264", "yuv420p", "ac3", ConvertPlan{Needed: true, CopyVideo: true}}, // only a new box and sound
		{".mkv", "h264", "", "aac", ConvertPlan{Needed: true, CopyVideo: true}},
		{".mp4", "h264", "yuv420p", "opus", ConvertPlan{Needed: true, CopyVideo: true}}, // only the sound
		{".ts", "h264", "yuv420p", "aac", ConvertPlan{Needed: true, CopyVideo: true}},
		{".mkv", "h264", "yuv420p10le", "aac", ConvertPlan{Needed: true}}, // 10-bit: encoded again
		{".mkv", "vp9", "yuv420p", "opus", ConvertPlan{Needed: true}},     // no VP9 on many Apple devices
		{".mkv", "av1", "yuv420p", "opus", ConvertPlan{Needed: true}},
		{".mp4", "hevc", "yuv420p", "aac", ConvertPlan{Needed: true}}, // picture encoded again
		{".avi", "mpeg4", "yuv420p", "mp3", ConvertPlan{Needed: true}},
		{".webm", "vp8", "yuv420p", "vorbis", ConvertPlan{Needed: true}},
	}
	for _, tt := range tests {
		got := PlanConversion(tt.ext, Info{VideoCodec: tt.video, PixelFormat: tt.pixels, AudioCodec: tt.audio})
		if got != tt.want {
			t.Errorf("PlanConversion(%q, %s %s/%s) = %+v, want %+v", tt.ext, tt.video, tt.pixels, tt.audio, got, tt.want)
		}
	}
}

func TestMP4AudioCodec(t *testing.T) {
	for codec, want := range map[string]string{"aac": "aac", "mp3": "mp3", "opus": "aac", "flac": "aac", "ac3": "aac", "dts": "aac", "vorbis": "aac"} {
		if got := MP4AudioCodec(codec); got != want {
			t.Errorf("MP4AudioCodec(%q) = %q, want %q", codec, got, want)
		}
	}
}
