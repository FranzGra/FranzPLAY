package video

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
)

func TestParseSubtitleStreams(t *testing.T) {
	data := `{"streams": [
		{"index": 2, "codec_name": "subrip", "tags": {"language": "ita"}, "disposition": {"forced": 0}},
		{"index": 3, "codec_name": "hdmv_pgs_subtitle", "tags": {"language": "eng"}},
		{"index": 4, "codec_name": "ass", "tags": {"language": "eng", "title": "  Commento\n del regista "}, "disposition": {"forced": 0}},
		{"index": 5, "codec_name": "mov_text", "tags": {"language": "und"}, "disposition": {"forced": 1}},
		{"index": 6, "codec_name": "subrip", "tags": {"language": "it<script>"}},
		{"index": 2, "codec_name": "subrip"}
	]}`
	got, err := ParseSubtitleStreams([]byte(data))
	if err != nil {
		t.Fatal(err)
	}
	want := []EmbeddedSubtitle{
		{Stream: 2, Lang: "ita"},
		{Stream: 4, Lang: "eng", Title: "Commento del regista"},
		{Stream: 5, Forced: true},
		{Stream: 6},
	}
	if !slices.Equal(got, want) {
		t.Errorf("got %+v\nwant %+v", got, want)
	}
}

func TestParseSubtitleStreamsLimits(t *testing.T) {
	var streams []string
	for i := range MaxEmbeddedSubtitles + 5 {
		streams = append(streams, fmt.Sprintf(`{"index": %d, "codec_name": "subrip", "tags": {"title": %q}}`,
			i, strings.Repeat("é", 150)))
	}
	got, err := ParseSubtitleStreams([]byte(`{"streams": [` + strings.Join(streams, ",") + `]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != MaxEmbeddedSubtitles {
		t.Errorf("kept %d subtitles, want %d", len(got), MaxEmbeddedSubtitles)
	}
	if n := len([]rune(got[0].Title)); n != maxTitleLen {
		t.Errorf("title of %d characters, want %d", n, maxTitleLen)
	}
	if subs, err := ParseSubtitleStreams([]byte(`{"streams": []}`)); err != nil || len(subs) != 0 {
		t.Errorf("no streams: %v, %v", subs, err)
	}
	if _, err := ParseSubtitleStreams([]byte(`not json`)); !errors.Is(err, ErrBadProbe) {
		t.Errorf("bad output: %v, want ErrBadProbe", err)
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
