package video

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
)

// TestToWebVTTLineEndingsAndTimes: the .srt files found next to videos,
// written by every kind of program, all become the same WebVTT.
func TestToWebVTTLineEndingsAndTimes(t *testing.T) {
	want := "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\nCiao\n"
	for name, in := range map[string]string{
		"unix":             "1\n00:00:01,000 --> 00:00:02,500\nCiao\n",
		"windows":          "1\r\n00:00:01,000 --> 00:00:02,500\r\nCiao\r\n",
		"old mac":          "1\r00:00:01,000 --> 00:00:02,500\rCiao\r",
		"byte order mark":  "\uFEFF1\n00:00:01,000 --> 00:00:02,500\nCiao\n",
		"dots for commas":  "1\n00:00:01.000 --> 00:00:02.500\nCiao\n",
		"one-digit hour":   "1\n0:00:01,000 --> 0:00:02,500\nCiao\n",
		"blank lines left": "\n\n1\n00:00:01,000 --> 00:00:02,500\nCiao\n",
	} {
		if got := ToWebVTT(in, "srt"); got != want {
			t.Errorf("%s:\ngot  %q\nwant %q", name, got, want)
		}
	}
}

// TestParseWebVTTFromSRT: what ToWebVTT makes of an .srt reads back as its
// cues, including the odd ones.
func TestParseWebVTTFromSRT(t *testing.T) {
	tests := map[string]struct {
		srt  string
		want []Cue
	}{
		"long film": {
			"1\n100:00:00,000 --> 100:00:01,500\nOltre cento ore\n",
			[]Cue{{Start: 100 * time.Hour, End: 100*time.Hour + 1500*time.Millisecond, Text: "Oltre cento ore"}},
		},
		"accents and emoji": {
			"1\n00:00:01,000 --> 00:00:02,000\nPerché sì 🎬 — “ok”\n",
			[]Cue{{Start: time.Second, End: 2 * time.Second, Text: "Perché sì 🎬 — “ok”"}},
		},
		"two lines of text": {
			"1\n00:00:01,000 --> 00:00:02,000\nPrima\nSeconda\n",
			[]Cue{{Start: time.Second, End: 2 * time.Second, Text: "Prima\nSeconda"}},
		},
		"no number before the times": {
			"00:00:01,000 --> 00:00:02,000\nUno\n\n00:00:03,000 --> 00:00:04,000\nDue\n",
			[]Cue{{Start: time.Second, End: 2 * time.Second, Text: "Uno"}, {Start: 3 * time.Second, End: 4 * time.Second, Text: "Due"}},
		},
		"many blank lines between cues": {
			"1\n00:00:01,000 --> 00:00:02,000\nUno\n\n\n\n2\n00:00:03,000 --> 00:00:04,000\nDue\n\n\n",
			[]Cue{{Start: time.Second, End: 2 * time.Second, Text: "Uno"}, {Start: 3 * time.Second, End: 4 * time.Second, Text: "Due"}},
		},
		"position after the times": {
			"1\n00:00:01,000 --> 00:00:02,000 X1:100 X2:200 Y1:10 Y2:20\nUno\n",
			[]Cue{{Start: time.Second, End: 2 * time.Second, Text: "Uno"}},
		},
		"a cue without text": {
			"1\n00:00:01,000 --> 00:00:02,000\n\n2\n00:00:03,000 --> 00:00:04,000\nDue\n",
			[]Cue{{Start: time.Second, End: 2 * time.Second, Text: ""}, {Start: 3 * time.Second, End: 4 * time.Second, Text: "Due"}},
		},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			got, err := ParseWebVTT(ToWebVTT(tt.srt, "srt"))
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got  %+v\nwant %+v", got, tt.want)
			}
		})
	}
}

// TestParseWebVTTMalformedTimes: a cue whose times cannot be read is left
// out, never read as a wrong time, and never stops the others.
func TestParseWebVTTMalformedTimes(t *testing.T) {
	for name, line := range map[string]string{
		"two-digit milliseconds": "00:00:01.00 --> 00:00:02.000",
		"no arrow":               "00:00:01.000 00:00:02.000",
		"letters":                "00:aa:01.000 --> 00:00:02.000",
		"one-digit seconds":      "00:00:1.000 --> 00:00:02.000",
		"empty":                  "-->",
	} {
		text := "WEBVTT\n\n" + line + "\nRotta\n\n00:00:05.000 --> 00:00:06.000\nBuona\n"
		got, err := ParseWebVTT(text)
		if err != nil {
			t.Errorf("%s: err = %v", name, err)
			continue
		}
		want := []Cue{{Start: 5 * time.Second, End: 6 * time.Second, Text: "Buona"}}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s: got %+v, want only the good cue", name, got)
		}
	}
}

// TestParseWebVTTBlankLinesWithSpaces: many .srt files end their cues with a
// line holding only spaces. Each cue must stay a cue of its own.
func TestParseWebVTTBlankLinesWithSpaces(t *testing.T) {
	srt := "1\n00:00:01,000 --> 00:00:02,000\nUno\n \n2\n00:00:03,000 --> 00:00:04,000\nDue\n"
	// The player reads what ToWebVTT gives: the browser too needs an empty line.
	for _, format := range []string{"srt", "vtt"} {
		if vtt := ToWebVTT(srt, format); !strings.Contains(vtt, "Uno\n\n2\n") {
			t.Errorf("%s: the line of spaces is still there: %q", format, vtt)
		}
	}
	got, err := ParseWebVTT(ToWebVTT(srt, "srt"))
	if err != nil {
		t.Fatal(err)
	}
	want := []Cue{{Start: time.Second, End: 2 * time.Second, Text: "Uno"}, {Start: 3 * time.Second, End: 4 * time.Second, Text: "Due"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got  %+v\nwant %+v", got, want)
	}
}

func TestDecodeSubtitleTextOddInput(t *testing.T) {
	tests := map[string]struct {
		in   []byte
		want string
	}{
		"empty":                    {nil, ""},
		"only a byte order mark":   {[]byte("\xEF\xBB\xBF"), ""},
		"utf-16 cut in the middle": {[]byte{0xFF, 0xFE, 'C', 0, 'i'}, "C"},
		"utf-16 emoji":             {[]byte{0xFF, 0xFE, 0x3C, 0xD8, 0xAC, 0xDF}, "🎬"},
		"windows-1252 holes":       {[]byte("a\x81b"), "a�b"},
		"windows-1252 every byte":  {[]byte("\xe0\xe8\xe9\xec\xf2\xf9"), "àèéìòù"},
	}
	for name, tt := range tests {
		if got := DecodeSubtitleText(tt.in); got != tt.want {
			t.Errorf("%s: got %q, want %q", name, got, tt.want)
		}
	}
}

// bigSRT is an .srt of 2000 cues, about the size of a long film's.
func bigSRT() string {
	var sb strings.Builder
	for i := range 2000 {
		start := time.Duration(i) * 3 * time.Second
		fmt.Fprintf(&sb, "%d\r\n%s --> %s\r\nBattuta numero %d, con l'accento è\r\nseconda riga\r\n\r\n",
			i+1, srtClock(start), srtClock(start+2*time.Second), i)
	}
	return sb.String()
}

func srtClock(d time.Duration) string {
	ms := d.Milliseconds()
	return fmt.Sprintf("%02d:%02d:%02d,%03d", ms/3_600_000, ms/60_000%60, ms/1000%60, ms%1000)
}

func TestBigSRT(t *testing.T) {
	cues, err := ParseWebVTT(ToWebVTT(bigSRT(), "srt"))
	if err != nil {
		t.Fatal(err)
	}
	if len(cues) != 2000 {
		t.Fatalf("cues = %d, want 2000", len(cues))
	}
	if last := cues[1999]; last.Start != 1999*3*time.Second || last.Text != "Battuta numero 1999, con l'accento è\nseconda riga" {
		t.Errorf("last cue = %+v", last)
	}
}

// BenchmarkToWebVTT measures turning a film's .srt into WebVTT, done each
// time the player asks for subtitles next to a video.
func BenchmarkToWebVTT(b *testing.B) {
	srt := bigSRT()
	b.SetBytes(int64(len(srt)))
	for b.Loop() {
		_ = ToWebVTT(srt, "srt")
	}
}

// BenchmarkParseWebVTT measures reading a film's subtitles, as a
// translation and an import do.
func BenchmarkParseWebVTT(b *testing.B) {
	vtt := ToWebVTT(bigSRT(), "srt")
	b.SetBytes(int64(len(vtt)))
	for b.Loop() {
		if _, err := ParseWebVTT(vtt); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkDecodeWindows1252 measures decoding an old Italian .srt.
func BenchmarkDecodeWindows1252(b *testing.B) {
	data := []byte(strings.ReplaceAll(bigSRT(), "è", "\xe8"))
	b.SetBytes(int64(len(data)))
	for b.Loop() {
		_ = DecodeSubtitleText(data)
	}
}
