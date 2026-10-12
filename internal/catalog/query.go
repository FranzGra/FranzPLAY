// Package catalog answers the interface's questions about the videos:
// the list, one video, the categories, and the video file itself.
package catalog

import (
	"errors"
	"fmt"
	"math/rand/v2"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Page sizes for the video list.
const (
	defaultLimit = 60
	maxLimit     = 200
)

// errBadQuery means the address had parameters FranzPLAY cannot use.
var errBadQuery = errors.New("bad query")

// Search limits: longer searches are refused, extra words ignored.
const (
	maxSearchLen   = 100 // characters
	maxSearchWords = 8
)

// listQuery is what the interface asks of the video list, already checked.
type listQuery struct {
	category string   // "" = all
	words    []string // search: every word must be in the title or the category
	limit    int
	offset   int
	// shuffle, when not 0, mixes the videos instead of showing the newest
	// first: the same number gives the same order, so the pages of one
	// visit follow on without repeats.
	shuffle uint64
}

// maxSeed is the biggest shuffle number accepted: the biggest whole
// number a browser counts exactly.
const maxSeed = 1<<53 - 1

// parseListQuery checks the parameters of GET /api/videos once, here.
// Accepted: category, q (search), limit (1 to 200), offset (0 or more),
// order=random with seed (1 to 2^53-1) for a mixed order.
func parseListQuery(values url.Values) (listQuery, error) {
	q := listQuery{category: strings.TrimSpace(values.Get("category")), limit: defaultLimit}
	search := values.Get("q")
	if utf8.RuneCountInString(search) > maxSearchLen {
		return listQuery{}, fmt.Errorf("%w: the search must be at most %d characters", errBadQuery, maxSearchLen)
	}
	q.words = searchWords(search)
	if s := values.Get("limit"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > maxLimit {
			return listQuery{}, fmt.Errorf("%w: limit must be a number from 1 to %d", errBadQuery, maxLimit)
		}
		q.limit = n
	}
	if s := values.Get("offset"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 0 {
			return listQuery{}, fmt.Errorf("%w: offset must be a number from 0", errBadQuery)
		}
		q.offset = n
	}
	switch values.Get("order") {
	case "", "newest":
		if values.Has("seed") {
			return listQuery{}, fmt.Errorf("%w: seed goes only with order=random", errBadQuery)
		}
	case "random":
		n, err := strconv.ParseUint(values.Get("seed"), 10, 64)
		if err != nil || n < 1 || n > maxSeed {
			return listQuery{}, fmt.Errorf("%w: order=random needs a seed from 1 to %d", errBadQuery, uint64(maxSeed))
		}
		q.shuffle = n
	default:
		return listQuery{}, fmt.Errorf("%w: order must be newest or random", errBadQuery)
	}
	return q, nil
}

// shuffled returns ids mixed in an order decided by seed alone.
func shuffled(ids []int64, seed uint64) []int64 {
	out := slices.Clone(ids)
	r := rand.New(rand.NewPCG(seed, 0))
	r.Shuffle(len(out), func(i, j int) { out[i], out[j] = out[j], out[i] })
	return out
}

// searchWords splits a search into its words, without repeats and at most
// maxSearchWords: "mare  Rimini mare" becomes ["mare", "Rimini"].
func searchWords(search string) []string {
	var words []string
	seen := map[string]bool{}
	for _, w := range strings.Fields(search) {
		key := strings.ToLower(w)
		if seen[key] {
			continue
		}
		seen[key] = true
		words = append(words, w)
		if len(words) == maxSearchWords {
			break
		}
	}
	return words
}

// likePattern turns a word into a LIKE pattern that finds it anywhere.
// The characters LIKE treats as wildcards (% and _) are escaped with \,
// so a search for "50%" finds "50%" and not everything starting with 50.
func likePattern(word string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(word) + "%"
}

// parseID checks a video id taken from the address.
func parseID(s string) (int64, bool) {
	id, err := strconv.ParseInt(s, 10, 64)
	return id, err == nil && id > 0
}

// validMadeName reports whether name looks like a file FranzPLAY made, a
// cover, a preview or a clip, ending in ext ("12-0a1b2c3d.jpg"). Anything
// else, such as "../franzplay.db", is refused before the disk is touched.
func validMadeName(name, ext string) bool {
	id, rest, ok := strings.Cut(name, "-")
	if !ok || !strings.HasSuffix(rest, ext) {
		return false
	}
	if _, ok := parseID(id); !ok {
		return false
	}
	hex := strings.TrimSuffix(rest, ext)
	if hex == "" || len(hex) > 8 {
		return false
	}
	for _, c := range hex {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

// contentTypes are the types sent with the video file, by extension.
var contentTypes = map[string]string{
	".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime",
	".webm": "video/webm", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
	".wmv": "video/x-ms-wmv", ".flv": "video/x-flv", ".ts": "video/mp2t",
	".m2ts": "video/mp2t", ".mts": "video/mp2t", ".mpg": "video/mpeg",
	".mpeg": "video/mpeg", ".3gp": "video/3gpp", ".ogv": "video/ogg",
}

// contentType returns the type of a video file, or a generic one.
func contentType(ext string) string {
	if t, ok := contentTypes[strings.ToLower(ext)]; ok {
		return t
	}
	return "application/octet-stream"
}
