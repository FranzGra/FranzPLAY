package online

import (
	"errors"
	"net/http"
	"slices"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// The administrator can also search a source by hand, with words of their
// choice, and pick a picture among the answers as the cover of a video.
// The pictures pass through FranzPLAY: the browser never talks to the
// sources, and only pictures on the sources' own servers are fetched, so
// this is never a way to download from anywhere else.

// maxWords is the longest search accepted.
const maxWords = 200

// maxCandidates is how many answers each source gives to a search.
const maxCandidates = 12

// allSources is the source to ask for a search in every source ready.
const allSources = "all"

// candidate is one answer to a search by hand.
type candidate struct {
	Title  string `json:"title"`
	Date   string `json:"date"`   // "2006-01-02"; "" when the source does not know it
	Author string `json:"author"` // "" when the source does not say
	// Picture and Thumb are what to ask GET /api/online/picture for, a
	// big picture and a small one; "" when the answer has none.
	Picture string `json:"picture"`
	Thumb   string `json:"thumb"`
	// Source is the code of the source that gave the answer, SourceName
	// the name to show.
	Source     string `json:"source"`
	SourceName string `json:"sourceName"`
	// Match is how much its title looks like the video's: see matchPercent.
	Match int `json:"match"`
}

// searchProblem says that a source gave no answers to a search in all the
// sources. Kind is "key" when it refused the key, "down" when it did not
// answer. Never the reason in the source's words: an address may hold a key.
type searchProblem struct {
	Source     string `json:"source"`
	SourceName string `json:"sourceName"`
	Kind       string `json:"kind"`
}

// searchSource is a source that can be searched by hand.
type searchSource struct {
	name  string // for the messages
	ready func(settings) (key string, ok bool)
	find  func(a api, r *http.Request, key, words string) ([]candidate, error)
}

var searchSources = map[string]searchSource{
	"tmdb": {name: "TMDB", find: api.findFilms,
		ready: func(s settings) (string, bool) { return s.tmdbKey, s.TMDB && s.tmdbKey != "" }},
	"tpdb": {name: "ThePornDB", find: api.findScenes,
		ready: func(s settings) (string, bool) { return s.tpdbKey, s.TPDB && s.tpdbKey != "" }},
}

// searchOrder is the order answers that match the same come in.
var searchOrder = []string{"tmdb", "tpdb"}

// handleSearch is GET /api/online/search?source=tmdb|tpdb|all&q=words&title=…
// title is the title of the video, to say how much each answer matches it;
// without it the words are compared. The answers come from the best match.
//
// Asked about one source, an error of the source is the error of the
// search. Asked about all, a source that fails is named in "problems" and
// the answers of the others stay: only with no source ready it is a 409.
func (a api) handleSearch(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("source")
	if _, ok := searchSources[name]; !ok && name != allSources {
		respond.Error(w, r, a.logger, http.StatusBadRequest, "this source cannot be searched")
		return
	}
	words := strings.TrimSpace(r.URL.Query().Get("q"))
	if words == "" || utf8.RuneCountInString(words) > maxWords || !utf8.ValidString(words) {
		respond.Error(w, r, a.logger, http.StatusBadRequest, "write what to search, in at most 200 characters")
		return
	}
	s, err := loadSettings(r.Context(), a.db)
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	names := readySources(s, name)
	if len(names) == 0 {
		respond.Error(w, r, a.logger, http.StatusConflict, "turn this source on first")
		return
	}
	answers := a.askSources(r, s, names, words)
	if name != allSources {
		switch err := answers[0].err; {
		case errors.Is(err, errKeyRefused):
			respond.Error(w, r, a.logger, http.StatusUnprocessableEntity, searchSources[name].name+" refused the key")
			return
		case err != nil:
			respond.Error(w, r, a.logger, http.StatusBadGateway, searchSources[name].name+" did not answer")
			return
		}
	}
	title := r.URL.Query().Get("title")
	if !utf8.ValidString(title) || strings.TrimSpace(title) == "" {
		title = words
	}
	results, problems := []candidate{}, []searchProblem{}
	for i, answer := range answers {
		if answer.err != nil {
			kind := "down"
			if errors.Is(answer.err, errKeyRefused) {
				kind = "key"
			}
			problems = append(problems, searchProblem{Source: names[i], SourceName: searchSources[names[i]].name, Kind: kind})
			continue
		}
		results = append(results, bestOf(answer.found, names[i], title)...)
	}
	sortByMatch(results)
	respond.JSON(w, r, a.logger, http.StatusOK, struct {
		Results  []candidate     `json:"results"`
		Problems []searchProblem `json:"problems"`
	}{results, problems})
}

// readySources are the sources to ask, out of the one asked for: only
// those turned on and with a key.
func readySources(s settings, asked string) []string {
	var names []string
	for _, name := range searchOrder {
		if asked != allSources && asked != name {
			continue
		}
		if _, ok := searchSources[name].ready(s); ok {
			names = append(names, name)
		}
	}
	return names
}

// sourceAnswer is what one source said.
type sourceAnswer struct {
	found []candidate
	err   error
}

// askSources asks every source at the same time: a slow one does not hold
// back the others more than its own time limit. The answers are in the
// order of names.
func (a api) askSources(r *http.Request, s settings, names []string, words string) []sourceAnswer {
	answers := make([]sourceAnswer, len(names))
	var wg sync.WaitGroup
	for i, name := range names {
		wg.Add(1)
		go func() {
			defer wg.Done()
			source := searchSources[name]
			key, _ := source.ready(s)
			found, err := source.find(a, r, key, words)
			if err != nil && !errors.Is(err, errKeyRefused) {
				a.logger.WarnContext(r.Context(), "search not answered", "source", source.name, "err", err)
			}
			answers[i] = sourceAnswer{found, err}
		}()
	}
	wg.Wait()
	return answers
}

// bestOf marks the answers of a source and keeps the ones that match best.
func bestOf(found []candidate, source, title string) []candidate {
	for i := range found {
		found[i].Source = source
		found[i].SourceName = searchSources[source].name
		found[i].Match = matchPercent(title, found[i].Title, found[i].Date)
	}
	sortByMatch(found)
	return found[:min(len(found), maxCandidates)]
}

// sortByMatch puts the best match first. Answers that match the same stay
// in the order the sources gave them, which is the sources' own best first.
func sortByMatch(found []candidate) {
	slices.SortStableFunc(found, func(a, b candidate) int { return b.Match - a.Match })
}

func (a api) findFilms(r *http.Request, key, words string) ([]candidate, error) {
	hits, err := a.tmdb.find(r.Context(), key, words)
	if err != nil {
		return nil, err
	}
	found := make([]candidate, 0, len(hits))
	for _, h := range hits {
		c := candidate{Title: h.Title, Date: h.ReleaseDate}
		if h.Picture != "" {
			c.Picture, c.Thumb = tmdbBig+h.Picture, tmdbSmall+h.Picture
		}
		found = append(found, c)
	}
	return found, nil
}

func (a api) findScenes(r *http.Request, key, words string) ([]candidate, error) {
	scenes, err := a.tpdb.find(r.Context(), key, words)
	if err != nil {
		return nil, err
	}
	found := make([]candidate, 0, len(scenes))
	for _, s := range scenes {
		found = append(found, candidate{Title: s.Title, Date: s.Date, Author: s.Author,
			Picture: s.Picture, Thumb: s.Thumb})
	}
	return found, nil
}

// pictureTypes are the pictures passed on to the browser.
var pictureTypes = map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true}

// handlePicture is GET /api/online/picture?source=tmdb|tpdb&at=…, with
// at as a search gave it.
func (a api) handlePicture(w http.ResponseWriter, r *http.Request) {
	name, at := r.URL.Query().Get("source"), r.URL.Query().Get("at")
	address, client, ok := a.pictureAddress(name, at)
	if !ok {
		respond.Error(w, r, a.logger, http.StatusBadRequest, "this is not a picture of the source")
		return
	}
	s, err := loadSettings(r.Context(), a.db)
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	if _, ok := searchSources[name].ready(s); !ok {
		respond.Error(w, r, a.logger, http.StatusConflict, "turn this source on first")
		return
	}
	data, status, err := get(r.Context(), client, address, nil, maxImage, "image/")
	switch {
	case err != nil:
		a.logger.WarnContext(r.Context(), "picture not downloaded", "source", name, "err", err)
		respond.Error(w, r, a.logger, http.StatusBadGateway, "the picture did not arrive")
		return
	case status == http.StatusNotFound:
		respond.Error(w, r, a.logger, http.StatusNotFound, "the source no longer has this picture")
		return
	case status != http.StatusOK:
		respond.Error(w, r, a.logger, http.StatusBadGateway, "the picture did not arrive")
		return
	}
	kind := http.DetectContentType(data)
	if !pictureTypes[kind] {
		respond.Error(w, r, a.logger, http.StatusBadGateway, "the source did not send a picture")
		return
	}
	w.Header().Set("Content-Type", kind)
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if _, err := w.Write(data); err != nil {
		a.logger.DebugContext(r.Context(), "picture not sent", "err", err)
	}
}

// pictureAddress says where a picture of a search is, and how to ask
// for it, if at really is one of the source's pictures.
func (a api) pictureAddress(source, at string) (string, *http.Client, bool) {
	switch source {
	case "tmdb":
		for _, size := range []string{tmdbBig, tmdbSmall} {
			if p, ok := strings.CutPrefix(at, size); ok && video.TMDBPicture(p) {
				return a.tmdb.images + at, a.tmdb.client, true
			}
		}
	case "tpdb":
		if video.TPDBPicture(at) {
			return at, a.tpdb.client, true
		}
	}
	return "", nil, false
}
