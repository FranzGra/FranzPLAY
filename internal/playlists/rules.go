// Package playlists keeps the lists of videos each person makes, and
// their "Guarda più tardi" list.
package playlists

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Limits: far more than a family needs, few enough to stay light.
const (
	maxNameLen   = 100  // characters of a name
	maxPlaylists = 500  // lists per person
	maxVideos    = 5000 // videos per list
)

// Kind tells an ordinary list from "Guarda più tardi".
type Kind string

// The kinds of list.
const (
	Ordinary   Kind = "playlist" // made and named by the person
	WatchLater Kind = "later"    // "Guarda più tardi": one each, made by FranzPLAY
)

// Refusals.
var (
	errBadName       = errors.New("a playlist name must have from 1 to 100 characters")
	errFixed         = errors.New("watch later cannot be renamed, deleted or made public")
	errNotYours      = errors.New("only the owner can change this playlist")
	errTooMany       = errors.New("too many playlists: delete one first")
	errFull          = errors.New("the playlist is full: remove a video first")
	errNotFound      = errors.New("playlist not found")
	errVideoNotFound = errors.New("video not found")
)

// cleanName checks a name typed by a person, once, on the way in: it
// must be valid text; control characters and repeated spaces go away.
func cleanName(name string) (string, error) {
	if !utf8.ValidString(name) {
		return "", errBadName
	}
	clean := strings.Join(strings.FieldsFunc(name, func(r rune) bool {
		return unicode.IsSpace(r) || unicode.IsControl(r)
	}), " ")
	if n := utf8.RuneCountInString(clean); n < 1 || n > maxNameLen {
		return "", errBadName
	}
	return clean, nil
}
