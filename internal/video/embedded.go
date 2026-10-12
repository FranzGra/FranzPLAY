package video

import (
	"encoding/json"
	"fmt"
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

// SubtitleProbeArgs are the ffprobe arguments, without the file, whose
// output ParseSubtitleStreams reads: only the subtitle streams.
var SubtitleProbeArgs = []string{
	"-v", "error",
	"-select_streams", "s",
	"-print_format", "json",
	"-show_entries", "stream=index,codec_name:stream_tags=language,title:stream_disposition=forced",
}

type subtitleProbe struct {
	Streams []struct {
		Index     int    `json:"index"`
		CodecName string `json:"codec_name"`
		Tags      struct {
			Language string `json:"language"`
			Title    string `json:"title"`
		} `json:"tags"`
		Disposition struct {
			Forced int `json:"forced"`
		} `json:"disposition"`
	} `json:"streams"`
}

// ParseSubtitleStreams reads ffprobe's answer (see SubtitleProbeArgs)
// into the text subtitles of a file. What comes from the file is checked
// here, once: a strange language becomes "", a title is cleaned and cut.
func ParseSubtitleStreams(data []byte) ([]EmbeddedSubtitle, error) {
	var out subtitleProbe
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrBadProbe, err)
	}
	var subs []EmbeddedSubtitle
	seen := map[int]bool{}
	for _, s := range out.Streams {
		if !textSubtitleCodecs[s.CodecName] || s.Index < 0 || seen[s.Index] {
			continue
		}
		seen[s.Index] = true
		lang := strings.TrimSpace(s.Tags.Language)
		if !validLang(lang) || strings.EqualFold(lang, "und") {
			lang = "" // "und" is how files say "not known"
		}
		subs = append(subs, EmbeddedSubtitle{
			Stream: s.Index,
			Lang:   lang,
			Title:  cleanTitle(s.Tags.Title),
			Forced: s.Disposition.Forced != 0,
		})
		if len(subs) == MaxEmbeddedSubtitles {
			break
		}
	}
	return subs, nil
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
	switch {
	case s.Forced:
		return label + " (forzati)"
	case s.Title != "" && !sameLanguage(s.Title, label, s.Lang):
		return label + " · " + s.Title
	default:
		return label
	}
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
