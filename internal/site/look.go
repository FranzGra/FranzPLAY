// Package site keeps how the whole site looks: its name, shown as a logo
// in two parts, and its main color. Everybody sees them, even before
// logging in; only the administrator changes them.
package site

import (
	"errors"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Look is the name and color of the site.
type Look struct {
	// The logo is the name in two parts: the first in the normal text
	// color, the second in the site's color, as in "Franz" "PLAY".
	NameFirst  string `json:"nameFirst"`
	NameSecond string `json:"nameSecond"`
	Color      string `json:"color"` // "#rrggbb", lower case
}

// Default is how a new FranzPLAY looks.
var Default = Look{NameFirst: "Franz", NameSecond: "PLAY", Color: "#2997ff"}

// maxNamePart is the longest part of the name: the logo must fit in the
// top bar of a phone.
const maxNamePart = 16

// Errors shown to people.
var (
	errBadName  = errors.New("each part of the name must be one line of at most 16 characters, and the first cannot be empty")
	errBadColor = errors.New(`the color must look like "#2997ff"`)
)

var colorShape = regexp.MustCompile(`^#[0-9a-f]{6}$`)

// Clean checks a look sent from outside and tidies it: spaces around the
// name are removed, the color is written in lower case.
func (l Look) Clean() (Look, error) {
	first, ok := cleanPart(l.NameFirst)
	if !ok || first == "" {
		return Look{}, errBadName
	}
	second, ok := cleanPart(l.NameSecond)
	if !ok {
		return Look{}, errBadName
	}
	color := strings.ToLower(strings.TrimSpace(l.Color))
	if !colorShape.MatchString(color) {
		return Look{}, errBadColor
	}
	return Look{NameFirst: first, NameSecond: second, Color: color}, nil
}

func cleanPart(s string) (string, bool) {
	s = strings.TrimSpace(s)
	if !utf8.ValidString(s) || utf8.RuneCountInString(s) > maxNamePart {
		return "", false
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return "", false
		}
	}
	return s, true
}
