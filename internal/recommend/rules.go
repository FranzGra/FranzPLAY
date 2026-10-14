// Package recommend suggests videos: the ones similar to the video being
// watched, and the ones a person may like. The rules are few and simple,
// so every suggestion can say why it is there: no heavy artificial
// intelligence, everything is worked out on the home computer.
package recommend

import (
	"cmp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Video is what the rules know of a video.
type Video struct {
	ID       int64
	Title    string
	Category string // "" = none
	AddedAt  int64  // Unix seconds: among equals, the newer comes first
}

// Reason says why a video is suggested. The interface turns it into words.
type Reason string

// The reasons, a closed list.
const (
	WatchedTogether Reason = "watchedTogether" // who watched this video also watched that one
	SameCategory    Reason = "sameCategory"    // same category as this video
	SimilarTitle    Reason = "similarTitle"    // words in common in the title
	YourCategory    Reason = "yourCategory"    // a category the person watches and likes
	Popular         Reason = "popular"         // the others watched or liked it
	Newest          Reason = "newest"          // nothing better: a recent video
)

// Pick is a suggested video with why.
type Pick struct {
	ID     int64
	Reason Reason
}

// The points of each rule. Being in the same category counts more than
// one word in common, less than three people who watched both videos.
const (
	categoryPoints = 3
	personPoints   = 2 // for each other person who watched both videos
	wordPoints     = 1 // for each word the titles have in common
	tastePoints    = 2 // for each point of Taste.Categories

	maxPeople = 3 // more people than this do not count more
	maxWords  = 3
	maxTaste  = 5
)

// Similar returns up to limit videos to watch after of, most similar first.
// together says, for each video, how many other people watched it as well
// as of; finished are the videos the person already watched to the end,
// which come after all the others. With nothing in common, the newest
// videos fill the list, so it is never empty while there are other videos.
func Similar(of Video, all []Video, together map[int64]int, finished map[int64]bool, limit int) []Pick {
	ofWords := titleWords(of.Title)
	// Only what the order needs: small items sort fast, even 10,000.
	type scored struct {
		pick     Pick
		addedAt  int64
		points   int
		finished bool
	}
	list := make([]scored, 0, len(all))
	for _, v := range all {
		if v.ID == of.ID {
			continue
		}
		people := min(together[v.ID], maxPeople) * personPoints
		category := 0
		if v.Category != "" && v.Category == of.Category {
			category = categoryPoints
		}
		words := sharedWords(ofWords, v.Title) * wordPoints

		// The reason is the rule that gave most points.
		reason := Newest
		switch best := max(people, category, words); {
		case best == 0:
		case people == best:
			reason = WatchedTogether
		case category == best:
			reason = SameCategory
		default:
			reason = SimilarTitle
		}
		list = append(list, scored{pick: Pick{ID: v.ID, Reason: reason}, addedAt: v.AddedAt,
			points: people + category + words, finished: finished[v.ID]})
	}
	slices.SortFunc(list, func(a, b scored) int {
		if a.finished != b.finished {
			if a.finished {
				return 1
			}
			return -1
		}
		return cmp.Or(cmp.Compare(b.points, a.points),
			newerFirst(Video{ID: a.pick.ID, AddedAt: a.addedAt}, Video{ID: b.pick.ID, AddedAt: b.addedAt}))
	})
	out := make([]Pick, 0, min(limit, len(list)))
	for _, s := range list[:min(limit, len(list))] {
		out = append(out, s.pick)
	}
	return out
}

// Taste is what a person showed they like.
type Taste struct {
	// Categories counts, for each category, 2 for every video liked and 1
	// for every video watched.
	Categories map[string]int
	// Known are the videos the person started, finished or liked: they
	// are not suggested again.
	Known map[int64]bool
}

// ForYou returns up to limit videos the person may like, best first:
// videos of the categories they watch and like, and videos the others
// watched or liked (others counts the people for each video). Only videos
// with a reason are returned: with no history the list is empty, and the
// Home shows the newest videos anyway.
func ForYou(all []Video, taste Taste, others map[int64]int, limit int) []Pick {
	type scored struct {
		Video
		pick   Pick
		points int
	}
	var list []scored
	for _, v := range all {
		if taste.Known[v.ID] {
			continue
		}
		liked := 0
		if v.Category != "" {
			liked = min(taste.Categories[v.Category], maxTaste) * tastePoints
		}
		popular := min(others[v.ID], maxPeople) * personPoints
		if liked == 0 && popular == 0 {
			continue
		}
		reason := Popular
		if liked >= popular {
			reason = YourCategory
		}
		list = append(list, scored{Video: v, pick: Pick{ID: v.ID, Reason: reason}, points: liked + popular})
	}
	slices.SortFunc(list, func(a, b scored) int {
		return cmp.Or(cmp.Compare(b.points, a.points), newerFirst(a.Video, b.Video))
	})
	out := make([]Pick, 0, min(limit, len(list)))
	for _, s := range list[:min(limit, len(list))] {
		out = append(out, s.pick)
	}
	return out
}

// newerFirst orders two videos from the newest; the same moment by id, so
// the order never changes from one request to the next.
func newerFirst(a, b Video) int {
	return cmp.Or(cmp.Compare(b.AddedAt, a.AddedAt), cmp.Compare(b.ID, a.ID))
}

// minWordLen is the shortest word that counts: shorter ones are mostly
// "il", "di", "the"…
const minWordLen = 4

// commonWords are words of 4 letters or more that say nothing about what
// a video is about.
var commonWords = map[string]bool{
	"alla": true, "allo": true, "dalla": true, "dalle": true, "della": true, "delle": true,
	"dello": true, "degli": true, "nella": true, "nelle": true, "sulla": true, "sulle": true,
	"come": true, "anche": true, "questo": true, "questa": true, "quello": true, "quella": true,
	"parte": true, "video": true, "episodio": true, "puntata": true,
	"with": true, "from": true, "that": true, "this": true, "your": true, "part": true, "episode": true,
}

// titleWords returns the words of a title that can say two videos are
// alike: in small letters, at least minWordLen long, not common ones.
func titleWords(title string) map[string]bool {
	words := map[string]bool{}
	for _, w := range strings.FieldsFunc(strings.ToLower(title), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}) {
		if utf8.RuneCountInString(w) >= minWordLen && !commonWords[w] {
			words[w] = true
		}
	}
	return words
}

// sharedWords counts the words of title that are in words, each once and
// at most maxWords: the same as finding titleWords of title and the words
// the two lists share, without making the second list. It runs for every
// video each time a video page opens, so it copies no words.
func sharedWords(words map[string]bool, title string) int {
	if len(words) == 0 {
		return 0
	}
	var found [maxWords]string
	n := 0
	lower := strings.ToLower(title)
	start := -1 // where the word being read began; -1 = between words
	// check counts the word that ends at end, if it is one of words.
	check := func(end int) bool {
		w := lower[start:end]
		start = -1
		if words[w] && !slices.Contains(found[:n], w) {
			found[n] = w
			n++
		}
		return n == maxWords
	}
	for i, r := range lower {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			if start < 0 {
				start = i
			}
		case start >= 0:
			if check(i) {
				return n
			}
		}
	}
	if start >= 0 {
		check(len(lower))
	}
	return n
}
