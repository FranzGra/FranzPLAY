package users

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Role is what a user may do. The list is closed.
type Role string

// The roles.
const (
	Admin Role = "admin" // manages users and settings
	User  Role = "user"  // watches, likes, comments
)

// parseRole checks a role read from outside or from the database.
func parseRole(s string) (Role, bool) {
	switch Role(s) {
	case Admin, User:
		return Role(s), true
	}
	return "", false
}

// errBadName means a user name cannot be used.
var errBadName = errors.New("the name must be from 3 to 32 letters, numbers, spaces, dots, dashes or underscores")

// CleanName checks a user name and removes spaces around it. Letters with
// accents are welcome ("Niccolò"); symbols that could confuse are not.
func CleanName(name string) (string, error) {
	name = strings.TrimSpace(name)
	n := utf8.RuneCountInString(name)
	if n < 3 || n > 32 {
		return "", errBadName
	}
	for _, r := range name {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) && !strings.ContainsRune(" ._-", r) {
			return "", errBadName
		}
	}
	if strings.Contains(name, "  ") {
		return "", errBadName
	}
	return name, nil
}
