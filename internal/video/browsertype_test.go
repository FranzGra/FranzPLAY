package video

import "testing"

func TestBrowserType(t *testing.T) {
	tests := []struct {
		ext, video, pixels, audio string
		want                      string
	}{
		{".mp4", "h264", "yuv420p", "aac", `video/mp4; codecs="avc1.640028, mp4a.40.2"`},
		{".MOV", "h264", "", "", `video/mp4; codecs="avc1.640028"`},
		{".mp4", "h264", "yuv420p10le", "aac", `video/mp4; codecs="avc1.6e0028, mp4a.40.2"`},
		{".mov", "hevc", "yuv420p10le", "aac", `video/mp4; codecs="hvc1.2.4.L120.90, mp4a.40.2"`}, // iPhone
		{".webm", "vp9", "yuv420p", "opus", `video/webm; codecs="vp09.00.40.08, opus"`},
		{".webm", "vp8", "yuv420p", "vorbis", `video/webm; codecs="vp8, vorbis"`},
		{".mp4", "av1", "yuv420p", "opus", `video/mp4; codecs="av01.0.08M.08, opus"`},
		{".mp4", "h264", "yuv420p", "ac3", `video/mp4; codecs="avc1.640028, ac-3"`},
		{".mkv", "h264", "yuv420p", "aac", ""},  // only some browsers open .mkv
		{".avi", "mpeg4", "yuv420p", "mp3", ""}, // no browser plays it
		{".mp4", "h264", "yuv420p", "dts", ""},  // sound with no browser name
		{".webm", "h264", "yuv420p", "opus", ""},
		{".mp4", "", "", "", ""}, // not read yet
	}
	for _, tt := range tests {
		got := BrowserType(tt.ext, Info{VideoCodec: tt.video, PixelFormat: tt.pixels, AudioCodec: tt.audio})
		if got != tt.want {
			t.Errorf("BrowserType(%q, %s %s/%s) = %q, want %q", tt.ext, tt.video, tt.pixels, tt.audio, got, tt.want)
		}
	}
}
