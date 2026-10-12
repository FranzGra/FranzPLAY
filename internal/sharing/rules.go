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
