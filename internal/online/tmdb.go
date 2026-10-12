package online

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/FranzGra/FranzPLAY/internal/video"
)

// maxTMDBAnswer is the biggest answer read from TMDB: a film with all its
// cast and crew can be a few hundred KB.
const maxTMDBAnswer = 1 << 20

// tmdb asks The Movie Database (themoviedb.org) about films, with the key
// the administrator entered.
type tmdb struct {
	client *http.Client
	api    string // https://api.themoviedb.org/3
	images string // https://image.tmdb.org/t/p/w1280
}

// newTMDB returns the client of TMDB's real addresses.
func newTMDB(client *http.Client) tmdb {
	return tmdb{client: client, api: "https://api.themoviedb.org/3", images: "https://image.tmdb.org/t/p/w1280"}
}

// errKeyRefused means a source said the key is not valid (any more).
var errKeyRefused = errors.New("the key was refused")

// searchLanguages are the languages a film is searched in: Italian first,
// then English, where TMDB knows more titles.
var searchLanguages = []string{"it-IT", "en-US"}

// lookup asks TMDB about the film the name of a file means. ok is false
// when no film is surely that one: nothing to show.
func (t tmdb) lookup(ctx context.Context, key string, q video.FilmQuery) (_ found, ok bool, err error) {
	var hit video.FilmHit
	for _, language := range searchLanguages {
		data, ok, err := t.ask(ctx, key, "/search/movie", url.Values{
			"query": {q.Title}, "primary_release_year": {strconv.Itoa(q.Year)}, "language": {language},
		})
		if err != nil || !ok {
			return found{}, false, err
		}
		hits, err := video.ParseTMDBSearch(data)
		if err != nil {
			return found{}, false, fmt.Errorf("tmdb search: %w", err)
		}
		if hit, ok = q.Pick(hits); ok {
			break
		}
	}
	if hit.ID == 0 {
		return found{}, false, nil
	}

	data, ok, err := t.ask(ctx, key, "/movie/"+strconv.FormatInt(hit.ID, 10), url.Values{
		"language": {"it-IT"}, "append_to_response": {"credits"},
	})
	if err != nil || !ok {
		return found{}, false, err
	}
	film, err := video.ParseTMDBMovie(data)
	if err != nil {
		return found{}, false, fmt.Errorf("tmdb film %d: %w", hit.ID, err)
	}
	f := found{details: film.Details}
	if film.Picture != "" {
		image, status, err := get(ctx, t.client, t.images+film.Picture, nil, maxImage, "image/")
		switch {
		case err != nil:
			return found{}, false, fmt.Errorf("tmdb film %d picture: %w", hit.ID, err)
		case status == http.StatusOK:
			f.image = image
		case status != http.StatusNotFound:
			return found{}, false, fmt.Errorf("tmdb film %d picture: answered %d", hit.ID, status)
		}
	}
	return f, true, nil
}

// checkKey asks TMDB if a key is valid, before it is saved.
func (t tmdb) checkKey(ctx context.Context, key string) error {
	_, ok, err := t.ask(ctx, key, "/authentication", url.Values{})
	if err == nil && !ok {
		return fmt.Errorf("tmdb: %w", errKeyRefused)
	}
	return err
}

// ask calls TMDB's API with the key: the long token goes in a header, the
// short key in the address, as TMDB wants. ok is false when TMDB does not
// know what was asked.
func (t tmdb) ask(ctx context.Context, key, path string, q url.Values) (_ []byte, ok bool, err error) {
	header := http.Header{}
	if strings.HasPrefix(key, "eyJ") {
		header.Set("Authorization", "Bearer "+key)
	} else {
		q.Set("api_key", key)
	}
	header.Set("Accept", "application/json")
	data, status, err := get(ctx, t.client, t.api+path+"?"+q.Encode(), header, maxTMDBAnswer, "application/json")
	if err != nil {
		return nil, false, fmt.Errorf("tmdb %s: %w", path, err)
	}
	switch status {
	case http.StatusOK:
		return data, true, nil
	case http.StatusNotFound:
		return nil, false, nil
	case http.StatusUnauthorized:
		return nil, false, fmt.Errorf("tmdb %s: %w", path, errKeyRefused)
	default:
		// Too many questions, or TMDB having a bad moment: try later.
		return nil, false, fmt.Errorf("tmdb %s: answered %d", path, status)
	}
}
