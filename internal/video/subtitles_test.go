package video

import (
	"reflect"
	"testing"
)

func TestFindSubtitles(t *testing.T) {
	names := []string{
		"mare.mp4", "mare.jpg", "mare.srt", "mare.it.srt", "mare.en-US.VTT", "mare.forced.it.srt",
		"mare.txt", "mareggiata.srt", "mare.it.srt.bak", "monte.it.srt", "mare.a b.srt",
	}
	got := FindSubtitles("/video/Viaggi/mare.mp4", names)
	want := []Subtitle{
		{Key: "en-US.VTT", Lang: "en-US", Format: "vtt"},
		{Key: "forced.it.srt", Lang: "forced.it", Format: "srt"},
		{Key: "it.srt", Lang: "it", Format: "srt"},
		{Key: "srt", Lang: "", Format: "srt"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got  %+v\nwant %+v", got, want)
	}
	if got := FindSubtitles("mare.mp4", []string{"mare.mp4"}); got != nil {
		t.Errorf("no subtitles: got %+v", got)
	}
}

func TestSubtitleLabel(t *testing.T) {
	for lang, want := range map[string]string{
		"":          "Sottotitoli",
		"it":        "Italiano",
		"ITA":       "Italiano",
		"en-US":     "Inglese (en-US)",
		"pt_BR":     "Portoghese (pt_BR)",
		"it.forced": "Italiano",
		"xx":        "XX",
	} {
		if got := SubtitleLabel(lang); got != want {
			t.Errorf("SubtitleLabel(%q) = %q, want %q", lang, got, want)
		}
	}
}

func TestLangCode(t *testing.T) {
	for lang, want := range map[string]string{"": "", "it": "it", "pt_BR": "pt-BR", "it.forced": "it"} {
		if got := LangCode(lang); got != want {
			t.Errorf("LangCode(%q) = %q, want %q", lang, got, want)
		}
	}
}

func TestDecodeSubtitleText(t *testing.T) {
	tests := map[string]struct {
		in   []byte
		want string
	}{
		"utf-8":          {[]byte("Perché sì"), "Perché sì"},
		"utf-8 with bom": {[]byte("\xEF\xBB\xBFCiao"), "Ciao"},
		"windows-1252":   {[]byte("Perch\xe9 s\xec \x80 \x93ok\x94"), "Perché sì € “ok”"},
		"utf-16 le":      {[]byte{0xFF, 0xFE, 'C', 0, 0xE0, 0}, "Cà"},
		"utf-16 be":      {[]byte{0xFE, 0xFF, 0, 'C', 0, 0xE0}, "Cà"},
	}
	for name, tt := range tests {
		if got := DecodeSubtitleText(tt.in); got != tt.want {
			t.Errorf("%s: got %q, want %q", name, got, tt.want)
		}
	}
}

func TestToWebVTT(t *testing.T) {
	srt := "\uFEFF1\r\n00:00:01,000 --> 00:00:02,500\r\nCiao, come va?\r\n\r\n2\r\n1:02:03,004 --> 1:02:04,000\r\nBene, 10:00:00,000 grazie\r\n"
	want := "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\nCiao, come va?\n\n2\n01:02:03.004 --> 01:02:04.000\nBene, 10:00:00,000 grazie\n"
	if got := ToWebVTT(srt, "srt"); got != want {
		t.Errorf("srt:\ngot  %q\nwant %q", got, want)
	}

	vtt := "WEBVTT\r\n\r\n00:01.000 --> 00:02.000\r\nCiao\r\n"
	if got := ToWebVTT(vtt, "vtt"); got != "WEBVTT\n\n00:01.000 --> 00:02.000\nCiao\n" {
		t.Errorf("vtt: got %q", got)
	}
	if got := ToWebVTT("00:01.000 --> 00:02.000\nCiao\n", "vtt"); got != "WEBVTT\n\n00:01.000 --> 00:02.000\nCiao\n" {
		t.Errorf("vtt without header: got %q", got)
	}
}
