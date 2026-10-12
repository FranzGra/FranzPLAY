package video

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
)

func TestParseTracks(t *testing.T) {
	data := `{"streams": [
		{"index": 0, "codec_type": "video", "codec_name": "h264"},
		{"index": 1, "codec_type": "audio", "codec_name": "ac3", "channels": 6, "tags": {"language": "ita"}, "disposition": {"default": 1}},
		{"index": 7, "codec_type": "audio", "codec_name": "aac", "channels": 2, "tags": {"language": "eng", "title": " Commento "}},
		{"index": 8, "codec_type": "audio", "codec_name": "a<b>", "channels": 999},
		{"index": 2, "codec_type": "subtitle", "codec_name": "subrip", "tags": {"language": "ita"}, "disposition": {"forced": 0}},
		{"index": 3, "codec_type": "subtitle", "codec_name": "hdmv_pgs_subtitle", "tags": {"language": "eng"}},
		{"index": 4, "codec_type": "subtitle", "codec_name": "ass", "tags": {"language": "eng", "title": "  Commento\n del regista "}},
		{"index": 5, "codec_type": "subtitle", "codec_name": "mov_text", "tags": {"language": "und"}, "disposition": {"forced": 1}},
		{"index": 6, "codec_type": "subtitle", "codec_name": "subrip", "tags": {"language": "it<script>"}},
		{"index": 2, "codec_type": "subtitle", "codec_name": "subrip"},
		{"index": 9, "codec_type": "data", "codec_name": "bin_data"}
	]}`
	got, err := ParseTracks([]byte(data))
	if err != nil {
		t.Fatal(err)
	}
	wantAudio := []EmbeddedAudio{
		{Stream: 1, Lang: "ita", Codec: "ac3", Channels: 6, Default: true},
		{Stream: 7, Lang: "eng", Title: "Commento", Codec: "aac", Channels: 2},
		{Stream: 8, Channels: 64},
	}
	wantSubs := []EmbeddedSubtitle{
		{Stream: 2, Lang: "ita"},
		{Stream: 4, Lang: "eng", Title: "Commento del regista"},
		{Stream: 5, Forced: true},
		{Stream: 6},
	}
	if !slices.Equal(got.Audio, wantAudio) {
		t.Errorf("audio %+v\nwant  %+v", got.Audio, wantAudio)
	}
	if !slices.Equal(got.Subtitles, wantSubs) {
		t.Errorf("subtitles %+v\nwant      %+v", got.Subtitles, wantSubs)
	}
}

func TestParseTracksLimits(t *testing.T) {
	var streams []string
	for i := range MaxEmbeddedSubtitles + 5 {
		streams = append(streams, fmt.Sprintf(`{"index": %d, "codec_type": "subtitle", "codec_name": "subrip", "tags": {"title": %q}}`,
			i, strings.Repeat("é", 150)))
	}
	for i := range MaxEmbeddedAudio + 5 {
		streams = append(streams, fmt.Sprintf(`{"index": %d, "codec_type": "audio", "codec_name": "aac"}`, 100+i))
	}
	got, err := ParseTracks([]byte(`{"streams": [` + strings.Join(streams, ",") + `]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Subtitles) != MaxEmbeddedSubtitles || len(got.Audio) != MaxEmbeddedAudio {
		t.Errorf("kept %d subtitles and %d sound tracks, want %d and %d",
			len(got.Subtitles), len(got.Audio), MaxEmbeddedSubtitles, MaxEmbeddedAudio)
	}
	if n := len([]rune(got.Subtitles[0].Title)); n != maxTitleLen {
		t.Errorf("title of %d characters, want %d", n, maxTitleLen)
	}
	if tr, err := ParseTracks([]byte(`{"streams": []}`)); err != nil || len(tr.Audio)+len(tr.Subtitles) != 0 {
		t.Errorf("no streams: %+v, %v", tr, err)
	}
	if _, err := ParseTracks([]byte(`not json`)); !errors.Is(err, ErrBadProbe) {
		t.Errorf("bad output: %v, want ErrBadProbe", err)
	}
}

func TestEmbeddedAudioLabel(t *testing.T) {
	tests := []struct {
		audio  EmbeddedAudio
		number int
		want   string
	}{
		{EmbeddedAudio{Lang: "ita"}, 1, "Italiano"},
		{EmbeddedAudio{Lang: "eng", Title: "Commento del regista"}, 2, "Inglese · Commento del regista"},
		{EmbeddedAudio{Lang: "eng", Title: "English"}, 2, "Inglese"},
		{EmbeddedAudio{}, 3, "Audio 3"},
		{EmbeddedAudio{Title: "Stereo"}, 1, "Audio 1 · Stereo"},
	}
	for _, tt := range tests {
		if got := tt.audio.Label(tt.number); got != tt.want {
			t.Errorf("Label(%+v, %d) = %q, want %q", tt.audio, tt.number, got, tt.want)
		}
	}
}

func TestEmbeddedSubtitleLabel(t *testing.T) {
	tests := []struct {
		sub  EmbeddedSubtitle
		want string
	}{
		{EmbeddedSubtitle{Lang: "ita"}, "Italiano"},
		{EmbeddedSubtitle{Lang: "eng", Forced: true}, "Inglese (forzati)"},
		{EmbeddedSubtitle{Lang: "eng", Title: "Commento"}, "Inglese · Commento"},
		{EmbeddedSubtitle{Lang: "ita", Title: "italiano"}, "Italiano"},
		{EmbeddedSubtitle{Lang: "eng", Title: "ENG"}, "Inglese"},
		{EmbeddedSubtitle{Lang: "eng", Title: "English"}, "Inglese"},
		{EmbeddedSubtitle{Lang: "eng", Title: "English SDH"}, "Inglese · English SDH"},
		{EmbeddedSubtitle{Title: "English"}, "Sottotitoli · English"},
		{EmbeddedSubtitle{Title: "SDH"}, "Sottotitoli · SDH"},
		{EmbeddedSubtitle{}, "Sottotitoli"},
	}
	for _, tt := range tests {
		if got := tt.sub.Label(); got != tt.want {
			t.Errorf("Label(%+v) = %q, want %q", tt.sub, got, tt.want)
		}
	}
}
