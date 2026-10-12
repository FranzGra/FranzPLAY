package video

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// EmbeddedSubtitle is a subtitle stored inside the video file, as some
// .mkv and .mp4 files have. Only text subtitles are kept: the browser
// cannot show the picture ones of DVDs and Blu-rays (dvd_subtitle, PGS).
type EmbeddedSubtitle struct {
	Stream int    // the stream's number inside the file, as ffprobe counts it
	Lang   string // "ita", "en"…; "" when the file does not say
	Title  string // the name the file gives it, "" if none
	Forced bool   // only the lines spoken in another language
}

// MaxEmbeddedSubtitles is the most subtitles kept from one file. Films
// rarely have more than a dozen; a file with hundreds is broken.
const MaxEmbeddedSubtitles = 30

// maxTitleLen is the most characters kept of a subtitle's title.
const maxTitleLen = 100

// textSubtitleCodecs are the subtitles ffmpeg can turn into WebVTT.
var textSubtitleCodecs = map[string]bool{
	"subrip": true, "srt": true, "ass": true, "ssa": true,
	"webvtt": true, "mov_text": true, "text": true,
}

// EmbeddedAudio is a sound track inside the video file, like the
// Italian and the English of a film.
type EmbeddedAudio struct {
	Stream   int    // the stream's number inside the file, as ffprobe counts it
	Lang     string // "ita", "en"…; "" when the file does not say
	Title    string // the name the file gives it, "" if none
	Codec    string // like "aac", "ac3"
	Channels int    // 2 = stereo, 6 = 5.1; 0 = not said
	Default  bool   // the one the file plays first
}

// MaxEmbeddedAudio is the most sound tracks kept from one file.
const MaxEmbeddedAudio = 30

// Tracks are the sound tracks and the text subtitles inside a file.
type Tracks struct {
	Audio     []EmbeddedAudio
	Subtitles []EmbeddedSubtitle
}

// TrackProbeArgs are the ffprobe arguments, without the file, whose
// output ParseTracks reads.
var TrackProbeArgs = []string{
	"-v", "error",
	"-print_format", "json",
	"-show_entries", "stream=index,codec_type,codec_name,channels:" +
		"stream_tags=language,title:stream_disposition=forced,default",
}

type trackProbe struct {
	Streams []struct {
		Index     int    `json:"index"`
		CodecType string `json:"codec_type"`
		CodecName string `json:"codec_name"`
		Channels  int    `json:"channels"`
		Tags      struct {
			Language string `json:"language"`
			Title    string `json:"title"`
		} `json:"tags"`
		Disposition struct {
			Forced  int `json:"forced"`
			Default int `json:"default"`
		} `json:"disposition"`
	} `json:"streams"`
}

// ParseTracks reads ffprobe's answer (see TrackProbeArgs) into the sound
// tracks and the text subtitles of a file. What comes from the file is
// checked here, once: a strange language becomes "", a title is cleaned
// and cut, a codec name with odd characters becomes "".
func ParseTracks(data []byte) (Tracks, error) {
	var out trackProbe
	if err := json.Unmarshal(data, &out); err != nil {
		return Tracks{}, fmt.Errorf("%w: %w", ErrBadProbe, err)
	}
	var t Tracks
	seen := map[int]bool{}
	for _, s := range out.Streams {
		if s.Index < 0 || seen[s.Index] {
			continue
		}
		seen[s.Index] = true
		lang := cleanLang(s.Tags.Language)
		switch {
		case s.CodecType == "audio" && len(t.Audio) < MaxEmbeddedAudio:
			t.Audio = append(t.Audio, EmbeddedAudio{
				Stream:   s.Index,
				Lang:     lang,
				Title:    cleanTitle(s.Tags.Title),
				Codec:    cleanCodec(s.CodecName),
				Channels: max(0, min(s.Channels, 64)),
				Default:  s.Disposition.Default != 0,
			})
		case s.CodecType == "subtitle" && textSubtitleCodecs[s.CodecName] && len(t.Subtitles) < MaxEmbeddedSubtitles:
			t.Subtitles = append(t.Subtitles, EmbeddedSubtitle{
				Stream: s.Index,
				Lang:   lang,
				Title:  cleanTitle(s.Tags.Title),
				Forced: s.Disposition.Forced != 0,
			})
		}
	}
	return t, nil
}

// cleanLang keeps a language code that looks like one; "und" is how
// files say "not known".
func cleanLang(lang string) string {
	lang = strings.TrimSpace(lang)
	if !validLang(lang) || strings.EqualFold(lang, "und") {
		return ""
	}
	return lang
}

// cleanCodec keeps a codec name made of plain characters.
func cleanCodec(codec string) string {
	if len(codec) > 30 {
		return ""
	}
	for _, r := range codec {
		plain := r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '_'
		if !plain {
			return ""
		}
	}
	return codec
}

// cleanTitle makes a title from a file safe to show: valid text, one
// line, at most maxTitleLen characters.
func cleanTitle(title string) string {
	if !utf8.ValidString(title) {
		return ""
	}
	clean := strings.Join(strings.FieldsFunc(title, func(r rune) bool {
		return unicode.IsSpace(r) || unicode.IsControl(r)
	}), " ")
	if utf8.RuneCountInString(clean) > maxTitleLen {
		clean = string([]rune(clean)[:maxTitleLen])
	}
	return clean
}

// Label is the subtitle's name in the player's menu: "Italiano",
// "Inglese (forzati)", "Italiano · Commento del regista".
func (s EmbeddedSubtitle) Label() string {
	label := SubtitleLabel(s.Lang)
	if s.Forced {
		return label + " (forzati)"
	}
	return withTitle(label, s.Title, s.Lang)
}

// Label is the sound track's name in the player's menu: "Italiano",
// "Inglese · Commento", or "Audio 2" (the number among the tracks, from
// 1) when the file does not say the language.
func (a EmbeddedAudio) Label(number int) string {
	label := "Audio " + strconv.Itoa(number)
	if a.Lang != "" {
		label = SubtitleLabel(a.Lang)
	}
	return withTitle(label, a.Title, a.Lang)
}

// withTitle adds a title to a label, unless it only repeats the language.
func withTitle(label, title, lang string) string {
	if title == "" || sameLanguage(title, label, lang) {
		return label
	}
	return label + " · " + title
}

// englishNames are the languages as files often title their subtitles.
var englishNames = map[string]bool{
	"italian": true, "english": true, "spanish": true, "french": true, "german": true,
	"portuguese": true, "russian": true, "japanese": true, "chinese": true, "arabic": true,
	"dutch": true, "polish": true, "romanian": true,
}

// sameLanguage reports whether a title only repeats the language, like
// "English" or "ita": showing it would say the same thing twice.
func sameLanguage(title, label, lang string) bool {
	return strings.EqualFold(title, label) || strings.EqualFold(title, lang) ||
		lang != "" && englishNames[strings.ToLower(title)]
}
