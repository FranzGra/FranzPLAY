package online

import (
	"errors"
	"net/http"
	"strings"
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

// maxCandidates is how many answers a search gives.
const maxCandidates = 12

// candidate is one answer to a search by hand.
type candidate struct {
	Title  string `json:"title"`
	Date   string `json:"date"`   // "2006-01-02"; "" when the source does not know it
	Author string `json:"author"` // "" when the source does not say
	// Picture and Thumb are what to ask GET /api/online/picture for, a
	// big picture and a small one; "" when the answer has none.
	Picture string `json:"picture"`
	Thumb   string `json:"thumb"`
}

// searchSource is a source that can be searched by hand.
type searchSource struct {
	name  string // for the messages
	ready func(settings) (key string, ok bool)
}

var searchSources = map[string]searchSource{
	"tmdb": {name: "TMDB", ready: func(s settings) (string, bool) { return s.tmdbKey, s.TMDB && s.tmdbKey != "" }},
	"tpdb": {name: "ThePornDB", ready: func(s settings) (string, bool) { return s.tpdbKey, s.TPDB && s.tpdbKey != "" }},
}

// handleSearch is GET /api/online/search?source=tmdb|tpdb&q=words.
func (a api) handleSearch(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("source")
	source, ok := searchSources[name]
	if !ok {
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
	key, ok := source.ready(s)
	if !ok {
		respond.Error(w, r, a.logger, http.StatusConflict, "turn this source on first")
		return
	}
	var found []candidate
	if name == "tmdb" {
		found, err = a.findFilms(r, key, words)
	} else {
		found, err = a.findScenes(r, key, words)
	}
	switch {
	case errors.Is(err, errKeyRefused):
		respond.Error(w, r, a.logger, http.StatusUnprocessableEntity, source.name+" refused the key")
		return
	case err != nil:
		a.logger.WarnContext(r.Context(), "search not answered", "source", source.name, "err", err)
		respond.Error(w, r, a.logger, http.StatusBadGateway, source.name+" did not answer")
		return
	}
	respond.JSON(w, r, a.logger, http.StatusOK, struct {
		Results []candidate `json:"results"`
	}{found[:min(len(found), maxCandidates)]})
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
