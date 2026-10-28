package video

import "testing"

func TestCoverImage(t *testing.T) {
	tests := []struct {
		name   string
		video  string
		folder []string
		want   string
	}{
		{"none", "mare.mp4", []string{"mare.mp4", "monti.jpg"}, ""},
		{"same name", "mare.mp4", []string{"mare.mp4", "mare.jpg"}, "mare.jpg"},
		{"png", "mare.mkv", []string{"mare.png"}, "mare.png"},
		{"webp", "mare.mkv", []string{"mare.webp"}, "mare.webp"},
		{"poster", "mare.mp4", []string{"mare-poster.jpg"}, "mare-poster.jpg"},
		{"thumb", "mare.mp4", []string{"mare-thumb.webp"}, "mare-thumb.webp"},
		{"cover", "mare.mp4", []string{"mare-cover.png"}, "mare-cover.png"},
		{"same name wins over poster", "mare.mp4", []string{"mare-poster.jpg", "mare.png"}, "mare.png"},
		{"jpg wins over png", "mare.mp4", []string{"mare.png", "mare.jpg"}, "mare.jpg"},
		{"poster wins over thumb", "mare.mp4", []string{"mare-thumb.jpg", "mare-poster.webp"}, "mare-poster.webp"},
		{"upper case", "Mare.MP4", []string{"MARE.JPG"}, "MARE.JPG"},
		{"dots in the name", "mare 2025.08.01.mp4", []string{"mare 2025.08.01.jpg"}, "mare 2025.08.01.jpg"},
		{"yt-dlp id", "mare [abc123].mp4", []string{"mare [abc123].webp"}, "mare [abc123].webp"},
		{"hidden", "mare.mp4", []string{"._mare.jpg"}, ""},
		{"another video's", "mare.mp4", []string{"mare2.jpg", "mare-2.jpg"}, ""},
		{"not a picture", "mare.mp4", []string{"mare.gif", "mare.srt", "mare.nfo"}, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := CoverImage(tt.video, tt.folder)
			if got != tt.want || ok != (tt.want != "") {
				t.Errorf("CoverImage(%q, %q) = %q, %v; want %q", tt.video, tt.folder, got, ok, tt.want)
			}
		})
	}
}

func TestImageVersion(t *testing.T) {
	v := ImageVersion("mare.jpg", 100, 5)
	if v == "" || v != ImageVersion("mare.jpg", 100, 5) {
		t.Fatalf("ImageVersion is not stable: %q", v)
	}
	for _, other := range []string{
		ImageVersion("mare.png", 100, 5),
		ImageVersion("mare.jpg", 101, 5),
		ImageVersion("mare.jpg", 100, 6),
	} {
		if other == v {
			t.Errorf("ImageVersion did not change: %q", v)
		}
	}
}
