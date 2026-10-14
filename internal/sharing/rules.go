// Package sharing lets a person show something private, an uploaded video
// or a playlist, to people they choose, and nobody else. What is shared
// stays out of every list, search and suggestion: the people chosen find
// it on their «Condivisi con te» page.
//
// The features that share keep their own tables (video_shares,
// playlist_shares); this package holds what they have in common: the
// check of the people chosen, and the list of people to choose from.
package sharing

import (
	"errors"
	"slices"
)

// This file is the pure core: no disk, no database, no clock.

// MaxPeople is how many people one thing can be shared with: more than a
// family, few enough to keep every check cheap.
const MaxPeople = 50

// Refusals people can fix.
var (
	ErrBadPeople     = errors.New("choose at most 50 people, by their id, without yourself")
	ErrUnknownPerson = errors.New("one of the people chosen is not on FranzPLAY")
	ErrNotPrivate    = errors.New("only something private can be shared with chosen people")
)

// Clean checks, once on the way in, the people owner chose: real ids, not
// the owner, at most MaxPeople. The answer is sorted, each person once;
// an empty list means nobody but the owner.
func Clean(ids []int64, owner int64) ([]int64, error) {
	out := slices.Clone(ids)
	slices.Sort(out)
	out = slices.Compact(out)
	if len(out) > MaxPeople {
		return nil, ErrBadPeople
	}
	for _, id := range out {
		if id <= 0 || id == owner {
			return nil, ErrBadPeople
		}
	}
	if out == nil {
		out = []int64{}
	}
	return out, nil
}

// Audiences: who sees something, as the interface names it.
const (
	ForEveryone = "everyone" // everybody, in every list
	ForMe       = "me"       // only its owner
	ForPeople   = "people"   // its owner and the people they chose
	ForLink     = "link"     // its owner and whoever opens its link
)

// AudienceOf says who sees something from how it is stored: private or
// not, shared with someone, with a link.
func AudienceOf(private, shared, link bool) string {
	switch {
	case !private:
		return ForEveryone
	case link:
		return ForLink
	case shared:
		return ForPeople
	default:
		return ForMe
	}
}

// ErrLinkNotPrivate refuses a link for something everybody sees already,
// or together with chosen people: a link is its own way of sharing.
var ErrLinkNotPrivate = errors.New("only something private and not shared with chosen people can have a link")

// keyLength is how many letters a link key has: 22 letters of base64 are
// 132 random bits, which nobody can guess.
const keyLength = 22

// ValidKey says whether s looks like a link key, before it is looked for.
func ValidKey(s string) bool {
	if len(s) != keyLength {
		return false
	}
	for _, c := range s {
		ok := c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_'
		if !ok {
			return false
		}
	}
	return true
}
