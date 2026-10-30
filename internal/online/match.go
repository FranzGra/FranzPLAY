package online

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// matchPercent says how much the title of an answer looks like the title
// of the video, from 0 to 100: the share of words the two have in common,
// after setting aside what does not change a title (capitals, accents,
// punctuation, "Parte 02" against "2"). A year in the video's title also
// counts when it is the year of the answer, written beside its title.
//
// It compares words and nothing else: it says nothing about the picture,
// and a misspelled word counts as a different word.
func matchPercent(videoTitle, title, date string) int {
	want, got := titleWords(videoTitle), titleWords(title)
	if len(date) >= 4 && isYear(date[:4]) && contains(want, date[:4]) && !contains(got, date[:4]) {
		got = append(got, date[:4])
	}
	if len(want) == 0 || len(got) == 0 {
		return 0
	}
	// "Spider-Man" and "Spiderman" are the same title in different words.
	if strings.Join(want, "") == strings.Join(got, "") {
		return 100
	}
	left := make(map[string]int, len(want))
	for _, word := range want {
		left[word]++
	}
	common := 0
	for _, word := range got {
		if left[word] > 0 {
			left[word]--
			common++
		}
	}
	return (200*common + (len(want)+len(got))/2) / (len(want) + len(got))
}

// plainLetters takes the accents off the letters of the languages titles
// are mostly in.
var plainLetters = strings.NewReplacer(
	"à", "a", "á", "a", "â", "a", "ã", "a", "ä", "a", "å", "a",
	"è", "e", "é", "e", "ê", "e", "ë", "e",
	"ì", "i", "í", "i", "î", "i", "ï", "i",
	"ò", "o", "ó", "o", "ô", "o", "õ", "o", "ö", "o",
	"ù", "u", "ú", "u", "û", "u", "ü", "u",
	"ñ", "n", "ç", "c", "ß", "ss",
)

// numberWords are the words that only announce a number: "Parte 2" and
// "2" are the same part.
var numberWords = map[string]bool{
	"episodio": true, "episode": true, "ep": true, "puntata": true, "parte": true, "part": true,
	"pt": true, "vol": true, "volume": true, "stagione": true, "season": true, "numero": true,
	"nr": true, "n": true,
}

var (
	seasonEpisode = regexp.MustCompile(`^s([0-9]+)e([0-9]+)$`)
	gluedNumber   = regexp.MustCompile(`^(ep|pt|vol|nr)([0-9]+)$`)
)

// titleWords are the words of a title that count when comparing it.
func titleWords(title string) []string {
	plain := plainLetters.Replace(strings.ToLower(title))
	fields := strings.FieldsFunc(plain, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	words := make([]string, 0, len(fields))
	for i, field := range fields {
		if numberWords[field] && i+1 < len(fields) && isNumber(fields[i+1]) {
			continue
		}
		if m := seasonEpisode.FindStringSubmatch(field); m != nil {
			words = append(words, plainNumber(m[1]), plainNumber(m[2]))
			continue
		}
		if m := gluedNumber.FindStringSubmatch(field); m != nil {
			words = append(words, plainNumber(m[2]))
			continue
		}
		if isNumber(field) {
			field = plainNumber(field)
		}
		words = append(words, field)
	}
	return words
}

func isNumber(word string) bool {
	for _, r := range word {
		if r < '0' || r > '9' {
			return false
		}
	}
	return word != ""
}

// plainNumber takes the zeros off the front of a number: "03" is 3.
func plainNumber(number string) string {
	if trimmed := strings.TrimLeft(number, "0"); trimmed != "" {
		return trimmed
	}
	return "0"
}

func isYear(word string) bool {
	year, err := strconv.Atoi(word)
	return err == nil && len(word) == 4 && year >= 1800 && year <= 2200
}

func contains(words []string, word string) bool {
	for _, w := range words {
		if w == word {
			return true
		}
	}
	return false
}
