package users

import (
	"errors"
	"strings"
)

// Color is a color as "#rrggbb", in small letters. The empty Color means
// "FranzPLAY's own".
type Color string

// errBadColor means a color is not written as "#rrggbb".
var errBadColor = errors.New(`the color must be written as "#rrggbb", or be empty for FranzPLAY's own`)

// parseColor checks a color that comes from outside: "#RRGGBB" in big or
// small letters, or "" to go back to FranzPLAY's own.
func parseColor(s string) (Color, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return "", nil
	}
	if len(s) != 7 || s[0] != '#' {
		return "", errBadColor
	}
	for _, c := range s[1:] {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return "", errBadColor
		}
	}
	return Color(s), nil
}
