package video

import (
	"errors"
	"reflect"
	"testing"
	"time"
)

func ms(n int64) time.Duration { return time.Duration(n) * time.Millisecond }

// whisperOutput is shaped like whisper.cpp's -oj file: tabs for indent,
// and a raw tab inside a text, which whisper does not escape.
const whisperOutput = "{\n\t\"systeminfo\": \"AVX = 1\",\n\t\"params\": {\n\t\t\"language\": \"auto\"\n\t},\n" +
	"\t\"result\": {\n\t\t\"language\": \"it\"\n\t},\n\t\"transcription\": [\n" +
	"\t\t{\"timestamps\": {\"from\": \"00:00:00,000\", \"to\": \"00:00:02,000\"}, \"offsets\": {\"from\": 0, \"to\": 2000}, \"text\": \" [BLANK_AUDIO]\"},\n" +
	"\t\t{\"offsets\": {\"from\": 2000, \"to\": 4500}, \"text\": \" Ciao a\ttutti, \\\"amici\\\"!\"},\n" +
	"\t\t{\"offsets\": {\"from\": 4500, \"to\": 6000}, \"text\": \" Ciao a tutti, \\\"amici\\\"!\"},\n" +
	"\t\t{\"offsets\": {\"from\": 6000, \"to\": 5000}, \"text\": \" Oggi andiamo al mare.\"},\n" +
	"\t\t{\"offsets\": {\"from\": 7000, \"to\": 8000}, \"text\": \"   \"}\n" +
	"\t]\n}\n"

func TestParseWhisperJSON(t *testing.T) {
	lang, cues, err := ParseWhisperJSON([]byte(whisperOutput))
	if err != nil {
		t.Fatal(err)
	}
	if lang != "it" {
		t.Errorf("lang = %q, want it", lang)
	}
	want := []Cue{
		{Start: ms(2000), End: ms(6000), Text: `Ciao a tutti, "amici"!`}, // repeated: one longer cue
		{Start: ms(6000), End: ms(6000), Text: "Oggi andiamo al mare."},  // end before start: fixed
	}
	if !reflect.DeepEqual(cues, want) {
		t.Errorf("cues = %+v\nwant   %+v", cues, want)
	}
}

func TestParseWhisperJSONRejects(t *testing.T) {
	for name, data := range map[string]string{
		"not json":     "whisper: error",
		"no language":  `{"transcription": []}`,
		"odd language": `{"result": {"language": "it\"; DROP"}, "transcription": []}`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, err := ParseWhisperJSON([]byte(data)); !errors.Is(err, ErrBadTranscript) {
				t.Errorf("err = %v, want ErrBadTranscript", err)
			}
		})
	}
}

func TestWebVTTRoundTrip(t *testing.T) {
	cues := []Cue{
		{Start: ms(1500), End: ms(3000), Text: "Tom & Jerry <3"},
		{Start: ms(3_723_456), End: ms(3_725_000), Text: "Prima riga\n\n  seconda riga  "},
	}
	text := WebVTT(cues)
	want := "WEBVTT\n\n00:00:01.500 --> 00:00:03.000\nTom &amp; Jerry &lt;3\n\n" +
		"01:02:03.456 --> 01:02:05.000\nPrima riga\nseconda riga\n"
	if text != want {
		t.Errorf("WebVTT =\n%q\nwant\n%q", text, want)
	}
	back, err := ParseWebVTT(text)
	if err != nil {
		t.Fatal(err)
	}
	cues[1].Text = "Prima riga\nseconda riga"
	if !reflect.DeepEqual(back, cues) {
		t.Errorf("read back %+v\nwant      %+v", back, cues)
	}
}

func TestParseWebVTTOtherFiles(t *testing.T) {
	text := "\uFEFFWEBVTT - fatto a mano\r\n\r\nNOTE una nota\r\n\r\n1\r\n00:01.000 --> 00:02.000 align:start\r\nUno\r\n\r\n00:03.000 --> 00:04.000\r\nDue\r\n"
	got, err := ParseWebVTT(text)
	if err != nil {
		t.Fatal(err)
	}
	want := []Cue{{Start: ms(1000), End: ms(2000), Text: "Uno"}, {Start: ms(3000), End: ms(4000), Text: "Due"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v, want %+v", got, want)
	}
	if _, err := ParseWebVTT("1\n00:00:01,000 --> 00:00:02,000\nsrt\n"); !errors.Is(err, ErrBadTranscript) {
		t.Errorf("srt: err = %v, want ErrBadTranscript", err)
	}
}

func TestWhisperModel(t *testing.T) {
	for file, want := range map[string]string{
		"ggml-small.bin":          "small",
		"ggml-medium-q5_0.bin":    "medium-q5_0",
		"ggml-large-v3-turbo.bin": "large-v3-turbo",
		"ggml-silero-v5.1.2.bin":  "",
		"ggml-small.bin.part":     "",
		"small.bin":               "",
		"ggml-../x.bin":           "",
		"ggml-Small.bin":          "",
	} {
		got, ok := WhisperModel(file)
		if got != want || ok != (want != "") {
			t.Errorf("WhisperModel(%q) = %q, %v; want %q", file, got, ok, want)
		}
	}
}

func TestIsAutoLanguage(t *testing.T) {
	if !IsAutoLanguage("it") || !IsAutoLanguage("pt") || IsAutoLanguage("auto") || IsAutoLanguage("IT") {
		t.Error("wrong answer")
	}
}

func TestWebVTTKeepsItalicsAndBold(t *testing.T) {
	got := WebVTT([]Cue{{End: ms(1000), Text: "<i>Ciao</i> <b>a</b> <font>tutti</font>"}})
	want := "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<i>Ciao</i> <b>a</b> &lt;font&gt;tutti&lt;/font&gt;\n"
	if got != want {
		t.Errorf("WebVTT = %q", got)
	}
}
