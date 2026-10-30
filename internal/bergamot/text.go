package bergamot

import (
	"regexp"
	"slices"
	"strings"
	"unicode"

	"github.com/FranzGra/FranzPLAY/internal/video"
)

// The translator reads one sentence per line and writes one line for each:
// that is what keeps every sentence with its times. So the text of a cue
// becomes one line, or a line for each speaker, and whatever marks the text
// (like <i>) stays out of the translator: around a whole line it is put back,
// on a word in the middle it is dropped, because the translator leaves such a
// word in the original language, and a word not translated is worse than a
// word not in bold.

var (
	// leadingMarks are the marks at the start of a text: <i>, {\an8}.
	leadingMarks = regexp.MustCompile(`^(?:\s*(?:<[^<>]*>|\{[^{}]*\}))+\s*`)
	// trailingMarks are the closing marks at its end: </i>.
	trailingMarks = regexp.MustCompile(`\s*(?:</[^<>]*>\s*)+$`)
	// speakerDash is the dash at the start of a speaker's line. The translator
	// makes up words when it sees one, so it stays out too.
	speakerDash = regexp.MustCompile(`^[-–—]\s*`)
	// tags finds the tags in the middle of a text.
	tags = regexp.MustCompile(`<[^<>]*>`)
	// oddBreaks are what could end a line for the translator, other than \n.
	oddBreaks = strings.NewReplacer("\r\n", "\n", "\r", "\n", "\u2028", "\n", "\u2029", "\n",
		"\u0085", "\n", "\f", "\n", "\v", "\n")
)

// piece is one part of a cue that goes to the translator by itself.
type piece struct {
	cue         int    // which cue it is part of
	open, close string // the marks put back around the translation
	text        string // what is translated; "" when nothing is, like "♪"
	keep        string // what stays when nothing is translated
}

// split turns cues into pieces, in order.
func split(cues []video.Cue) []piece {
	var out []piece
	for i, cue := range cues {
		for _, line := range cueLines(cue.Text) {
			out = append(out, pieceOf(i, line))
		}
	}
	return out
}

// cueLines splits a text in what is translated by itself. A sentence that
// goes on over two lines is one sentence and is translated as such: the
// player wraps the result. Lines of different speakers stay apart.
func cueLines(text string) []string {
	var lines []string
	for line := range strings.SplitSeq(oddBreaks.Replace(text), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			lines = append(lines, line)
		}
	}
	if slices.ContainsFunc(lines, isSpeaker) {
		return lines
	}
	if len(lines) == 0 {
		return nil
	}
	return []string{strings.Join(lines, " ")}
}

// isSpeaker reports whether a line starts with the dash of a speaker.
func isSpeaker(line string) bool {
	line = leadingMarks.ReplaceAllString(line, "")
	return strings.HasPrefix(line, "-") || strings.HasPrefix(line, "–") || strings.HasPrefix(line, "—")
}

// pieceOf takes the marks off the ends of a line. Without any letter there
// is nothing to translate: a "♪", a "...", a number stay as they are.
func pieceOf(cue int, line string) piece {
	open := leadingMarks.FindString(line)
	dash := speakerDash.FindString(line[len(open):])
	open = line[:len(open)+len(dash)]
	rest := line[len(open):]
	closing := trailingMarks.FindString(rest)
	text := tags.ReplaceAllString(rest[:len(rest)-len(closing)], "")
	if !strings.ContainsFunc(text, unicode.IsLetter) {
		return piece{cue: cue, keep: line}
	}
	return piece{cue: cue, open: open, close: closing, text: text}
}

// texts returns the lines for the translator.
func texts(pieces []piece) []string {
	var out []string
	for _, p := range pieces {
		if p.text != "" {
			out = append(out, p.text)
		}
	}
	return out
}

// join puts the translated lines back in the cues, times untouched. There
// must be one line for each text: the caller has checked.
func join(cues []video.Cue, pieces []piece, translated []string) []video.Cue {
	parts := make([][]string, len(cues))
	next := 0
	for _, p := range pieces {
		line := p.keep
		if p.text != "" {
			line = p.open + orOriginal(translated[next], p.text) + p.close
			next++
		}
		parts[p.cue] = append(parts[p.cue], line)
	}
	out := make([]video.Cue, len(cues))
	for i, cue := range cues {
		cue.Text = strings.Join(parts[i], "\n")
		out[i] = cue
	}
	return out
}

// orOriginal is a translated line, or the original when it came back empty,
// so that a sentence never disappears.
func orOriginal(translated, original string) string {
	if translated = strings.TrimSpace(translated); translated != "" {
		return translated
	}
	return original
}
