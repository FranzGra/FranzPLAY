package video

import "testing"

func TestPlanConversion(t *testing.T) {
	tests := []struct {
		ext, video, audio string
		want              ConvertPlan
	}{
		{".mp4", "h264", "aac", ConvertPlan{}},                              // plays as it is
		{".mp4", "", "", ConvertPlan{}},                                     // not read yet
		{".mkv", "h264", "ac3", ConvertPlan{Needed: true, CopyVideo: true}}, // only a new box and sound
		{".mkv", "vp9", "opus", ConvertPlan{Needed: true, CopyVideo: true}},
		{".mp4", "hevc", "aac", ConvertPlan{Needed: true}}, // picture encoded again
		{".avi", "mpeg4", "mp3", ConvertPlan{Needed: true}},
		{".mkv", "vp8", "vorbis", ConvertPlan{Needed: true}}, // MP4 cannot hold VP8
	}
	for _, tt := range tests {
		got := PlanConversion(tt.ext, Info{VideoCodec: tt.video, AudioCodec: tt.audio})
		if got != tt.want {
			t.Errorf("PlanConversion(%q, %s/%s) = %+v, want %+v", tt.ext, tt.video, tt.audio, got, tt.want)
		}
	}
}

func TestMP4AudioCodec(t *testing.T) {
	for codec, want := range map[string]string{"aac": "aac", "opus": "opus", "ac3": "aac", "dts": "aac", "vorbis": "aac"} {
		if got := MP4AudioCodec(codec); got != want {
			t.Errorf("MP4AudioCodec(%q) = %q, want %q", codec, got, want)
		}
	}
}
