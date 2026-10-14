package video

import (
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

// Subtitle is a subtitle file found next to a video, with the video's
// name: "mare.srt", "mare.it.srt", "mare.en.vtt" (the way yt-dlp and most
// download tools save them).
type Subtitle struct {
	Key    string // the file name after the video's name: "it.srt"; identifies it in the API
	Lang   string // "it", "en-US"… or "" when the name has no language
	Format string // "srt" or "vtt"
}

// FindSubtitles picks, among the names of the files in a video's folder,
// the subtitles of videoFile. Pure: the caller reads the folder.
func FindSubtitles(videoFile string, names []string) []Subtitle {
	base := strings.TrimSuffix(filepath.Base(videoFile), filepath.Ext(videoFile)) + "."
	var out []Subtitle
	for _, name := range names {
		if !strings.HasPrefix(name, base) {
			continue
		}
		key := name[len(base):] // "it.srt", or just "srt"
		lang, format := "", key
		if dot := strings.LastIndex(key, "."); dot >= 0 {
			lang, format = key[:dot], key[dot+1:]
		}
		format = strings.ToLower(format)
		if format != "srt" && format != "vtt" {
			continue
		}
		if !validLang(lang) {
			continue
		}
		out = append(out, Subtitle{Key: key, Lang: lang, Format: format})
	}
	slices.SortFunc(out, func(a, b Subtitle) int { return strings.Compare(a.Key, b.Key) })
	return out
}

// validLang accepts "", "it", "en-US", "pt_BR", "it.forced": short, plain.
func validLang(lang string) bool {
	if len(lang) > 20 {
		return false
	}
	for _, r := range lang {
		plain := r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' || r == '.'
		if !plain {
			return false
		}
	}
	return true
}

// languages are the names shown in the player for the commonest codes.
var languages = map[string]string{
	"it": "Italiano", "ita": "Italiano",
	"en": "Inglese", "eng": "Inglese",
	"es": "Spagnolo", "spa": "Spagnolo",
	"fr": "Francese", "fra": "Francese", "fre": "Francese",
	"de": "Tedesco", "deu": "Tedesco", "ger": "Tedesco",
	"pt": "Portoghese", "por": "Portoghese",
	"ru": "Russo", "rus": "Russo",
	"ja": "Giapponese", "jpn": "Giapponese",
	"zh": "Cinese", "zho": "Cinese", "chi": "Cinese",
	"ar": "Arabo", "ara": "Arabo",
	"nl": "Olandese", "nld": "Olandese",
	"pl": "Polacco", "pol": "Polacco",
	"ro": "Rumeno", "ron": "Rumeno",
}

// SubtitleLabel is the name of a subtitle in the player's menu:
// "Italiano", "Inglese (en-US)", "Sottotitoli" when the language is not said.
func SubtitleLabel(lang string) string {
	if lang == "" {
		return "Sottotitoli"
	}
	code, _, _ := strings.Cut(strings.ToLower(lang), ".")
	main, _, regional := strings.Cut(strings.ReplaceAll(code, "_", "-"), "-")
	name, ok := languages[main]
	switch {
	case !ok:
		return strings.ToUpper(code)
	case regional:
		return name + " (" + lang + ")"
	default:
		return name
	}
}

// twoLetters are the short codes browsers expect for the three-letter
// ones that video files often use.
var twoLetters = map[string]string{
	"ita": "it", "eng": "en", "spa": "es", "fra": "fr", "fre": "fr", "deu": "de", "ger": "de",
	"por": "pt", "rus": "ru", "jpn": "ja", "zho": "zh", "chi": "zh", "ara": "ar",
	"nld": "nl", "dut": "nl", "pol": "pl", "ron": "ro", "rum": "ro",
}

// LangCode is the language for the browser (the srclang of a track): the
// first part of the name, "" when unknown. "ita" becomes "it".
func LangCode(lang string) string {
	code, _, _ := strings.Cut(lang, ".")
	if short, ok := twoLetters[strings.ToLower(code)]; ok {
		return short
	}
	return strings.ReplaceAll(code, "_", "-")
}

// DecodeSubtitleText turns a subtitle file into text. Files are often not
// UTF-8: old Italian .srt files are usually Windows-1252, some are UTF-16.
func DecodeSubtitleText(b []byte) string {
	switch {
	case len(b) >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF:
		return string(b[3:])
	case len(b) >= 2 && b[0] == 0xFF && b[1] == 0xFE:
		return decodeUTF16(b[2:], false)
	case len(b) >= 2 && b[0] == 0xFE && b[1] == 0xFF:
		return decodeUTF16(b[2:], true)
	case utf8.Valid(b):
		return string(b)
	}
	return decodeWindows1252(b)
}

func decodeUTF16(b []byte, bigEndian bool) string {
	units := make([]uint16, len(b)/2)
	for i := range units {
		if bigEndian {
			units[i] = uint16(b[2*i])<<8 | uint16(b[2*i+1])
		} else {
			units[i] = uint16(b[2*i+1])<<8 | uint16(b[2*i])
		}
	}
	return string(utf16.Decode(units))
}

// windows1252 are the characters that Windows-1252 puts at 0x80–0x9F, where
// Latin-1 has control codes. Every other byte is the same as in Latin-1.
var windows1252 = [32]rune{
	'€', '�', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '�', 'Ž', '�',
	'�', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '�', 'ž', 'Ÿ',
}

func decodeWindows1252(b []byte) string {
	var sb strings.Builder
	sb.Grow(len(b) + len(b)/8)
	for _, c := range b {
		if c >= 0x80 && c <= 0x9F {
			sb.WriteRune(windows1252[c-0x80])
		} else {
			sb.WriteRune(rune(c))
		}
	}
	return sb.String()
}

// srtTime is a time in an .srt cue line: "0:01:02,345" or "00:01:02,345".
var srtTime = regexp.MustCompile(`(\d+):(\d{2}):(\d{2})[,.](\d{3})`)

// ToWebVTT turns the text of an .srt or .vtt file into WebVTT, the only
// subtitle format browsers read. An .srt only needs a header and dots
// instead of commas in its times.
func ToWebVTT(text, format string) string {
	text = strings.TrimPrefix(text, "\uFEFF")
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	if format == "vtt" {
		if strings.HasPrefix(text, "WEBVTT") {
			return text
		}
		return "WEBVTT\n\n" + text
	}
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		if strings.Contains(line, "-->") {
			lines[i] = srtTime.ReplaceAllStringFunc(line, func(t string) string {
				m := srtTime.FindStringSubmatch(t)
				hours := m[1]
				if len(hours) < 2 {
					hours = "0" + hours // WebVTT wants at least two digits
				}
				return hours + ":" + m[2] + ":" + m[3] + "." + m[4]
			})
		}
	}
	return "WEBVTT\n\n" + strings.TrimLeft(strings.Join(lines, "\n"), "\n")
}
