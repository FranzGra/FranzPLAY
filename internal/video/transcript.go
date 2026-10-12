package video

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Cue is one line of subtitles and when it shows.
type Cue struct {
	Start, End time.Duration
	Text       string
}

// AutoLanguages are the languages automatic subtitles can be made in, the
// same as in the old FranzPLAY. The list is closed: what the administrator
// asks for is checked against it.
var AutoLanguages = []string{"it", "en", "es", "fr", "de", "pt"}

// IsAutoLanguage reports whether automatic subtitles can be made in lang.
func IsAutoLanguage(lang string) bool {
	return slices.Contains(AutoLanguages, lang)
}

// ErrBadTranscript means whisper wrote something FranzPLAY cannot read.
var ErrBadTranscript = errors.New("unreadable transcript")

// spokenLanguage is a language code as whisper writes it: "it", "en", "haw".
var spokenLanguage = regexp.MustCompile(`^[a-z]{2,3}$`)

// whisperJSON is the part of whisper.cpp's JSON output (-oj) we read.
type whisperJSON struct {
	Result struct {
		Language string `json:"language"`
	} `json:"result"`
	Transcription []struct {
		Offsets struct {
			From int64 `json:"from"` // milliseconds
			To   int64 `json:"to"`
		} `json:"offsets"`
		Text string `json:"text"`
	} `json:"transcription"`
}

// ParseWhisperJSON reads what whisper.cpp heard: the language spoken and
// the cues. Cues that only describe a sound, like "[BLANK_AUDIO]" or
// "[Musica]", are left out, and a line whisper repeats right after itself
// (it sometimes does, on music) becomes one longer cue.
func ParseWhisperJSON(data []byte) (lang string, cues []Cue, err error) {
	var w whisperJSON
	if err := json.Unmarshal(cleanControls(data), &w); err != nil {
		return "", nil, fmt.Errorf("%w: %w", ErrBadTranscript, err)
	}
	lang = w.Result.Language
	if !spokenLanguage.MatchString(lang) {
		return "", nil, fmt.Errorf("%w: language %q", ErrBadTranscript, lang)
	}
	for _, seg := range w.Transcription {
		text := strings.Join(strings.Fields(seg.Text), " ")
		if text == "" || strings.HasPrefix(text, "[") && strings.HasSuffix(text, "]") {
			continue
		}
		start := time.Duration(max(seg.Offsets.From, 0)) * time.Millisecond
		end := max(time.Duration(seg.Offsets.To)*time.Millisecond, start)
		if n := len(cues); n > 0 && cues[n-1].Text == text {
			cues[n-1].End = max(cues[n-1].End, end)
			continue
		}
		cues = append(cues, Cue{Start: start, End: end, Text: text})
	}
	return lang, cues, nil
}

// cleanControls turns the control characters in whisper's JSON into
// spaces. whisper.cpp escapes only quotes and backslashes, so a tab or a
// new line said in a cue would make the JSON unreadable. Outside the
// strings they are spaces anyway.
func cleanControls(data []byte) []byte {
	out := slices.Clone(data)
	for i, b := range out {
		if b < 0x20 {
			out[i] = ' '
		}
	}
	return out
}

// WebVTT writes cues as a WebVTT file, the subtitle format browsers read.
func WebVTT(cues []Cue) string {
	var sb strings.Builder
	sb.WriteString("WEBVTT\n")
	for _, c := range cues {
		sb.WriteString("\n" + vttTime(c.Start) + " --> " + vttTime(c.End) + "\n")
		sb.WriteString(vttText(c.Text) + "\n")
	}
	return sb.String()
}

// vttTime writes a time as WebVTT wants it: "01:02:03.456".
func vttTime(d time.Duration) string {
	ms := d.Milliseconds()
	return fmt.Sprintf("%02d:%02d:%02d.%03d", ms/3_600_000, ms/60_000%60, ms/1000%60, ms%1000)
}

// vttEscapes are the characters WebVTT reads as markup in a cue.
var vttEscapes = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")

// vttText is a cue's text, safe inside a WebVTT file: no markup, and no
// empty line, which would end the cue.
func vttText(text string) string {
	var lines []string
	for line := range strings.Lines(text) {
		if line = strings.TrimSpace(line); line != "" {
			lines = append(lines, vttEscapes.Replace(line))
		}
	}
	return strings.Join(lines, "\n")
}

// vttUnescapes undo vttEscapes, plus the spaces WebVTT may write by name.
var vttUnescapes = strings.NewReplacer("&lt;", "<", "&gt;", ">", "&nbsp;", " ", "&amp;", "&")

// vttTiming is the line of a cue that says when it shows:
// "00:01:02.345 --> 00:01:04.000", the hours may be left out.
var vttTiming = regexp.MustCompile(`^((?:\d+:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}\.\d{3})`)

// ParseWebVTT reads the cues of a WebVTT file, like one written by WebVTT.
// It is used to translate subtitles already made.
func ParseWebVTT(text string) ([]Cue, error) {
	text = strings.ReplaceAll(strings.TrimPrefix(text, "\uFEFF"), "\r\n", "\n")
	if !strings.HasPrefix(text, "WEBVTT") {
		return nil, fmt.Errorf("%w: not WebVTT", ErrBadTranscript)
	}
	var cues []Cue
	for block := range strings.SplitSeq(text, "\n\n") {
		lines := strings.Split(strings.Trim(block, "\n"), "\n")
		for i, line := range lines {
			m := vttTiming.FindStringSubmatch(line)
			if m == nil {
				continue
			}
			start, err1 := parseVTTTime(m[1])
			end, err2 := parseVTTTime(m[2])
			if err := errors.Join(err1, err2); err != nil {
				return nil, err
			}
			cues = append(cues, Cue{Start: start, End: end, Text: vttUnescapes.Replace(strings.Join(lines[i+1:], "\n"))})
			break
		}
	}
	return cues, nil
}

// parseVTTTime reads "01:02:03.456" or "02:03.456".
func parseVTTTime(s string) (time.Duration, error) {
	clock, millis, _ := strings.Cut(s, ".")
	parts := strings.Split(clock, ":")
	var total int64
	for _, p := range parts {
		n, err := strconv.ParseInt(p, 10, 64)
		if err != nil {
			return 0, fmt.Errorf("%w: time %q", ErrBadTranscript, s)
		}
		total = total*60 + n
	}
	ms, err := strconv.ParseInt(millis, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%w: time %q", ErrBadTranscript, s)
	}
	return time.Duration(total)*time.Second + time.Duration(ms)*time.Millisecond, nil
}

// whisperModel is the name of a whisper.cpp model file: "ggml-small.bin",
// "ggml-medium-q5_0.bin".
var whisperModel = regexp.MustCompile(`^ggml-([a-z0-9][a-z0-9._-]*)\.bin$`)

// WhisperModel reads the name of a model from its file name: "small" from
// "ggml-small.bin". ok is false for any other file, and for the small
// models that only find where people speak (silero), which cannot write.
func WhisperModel(fileName string) (name string, ok bool) {
	m := whisperModel.FindStringSubmatch(fileName)
	if m == nil || strings.HasPrefix(m[1], "silero") {
		return "", false
	}
	return m[1], true
}
