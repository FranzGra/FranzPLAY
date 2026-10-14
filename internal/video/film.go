package video

import (
	"encoding/json"
	"fmt"
	"path"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// FilmQuery is what the name of a file says about a film: its title and
// the year it came out, like "Il sorpasso (1962).mkv" or
// "The.Matrix.1999.1080p.mkv".
type FilmQuery struct {
	Title string
	Year  int
}

// yearInName finds the last year in a name, between separators: what is
// before it is the title, what is after it (quality, language…) is not.
var yearInName = regexp.MustCompile(`^(.+)[\s._(\[-]((?:19|20)\d\d)(?:[\s._)\]-].*)?$`)

// FilmInName reads a film's title and year in the name of a video file.
// Only the name is looked at, not the folders. A name without a year, or
// one saved from YouTube, is not a film's.
func FilmInName(file string) (FilmQuery, bool) {
	if _, ok := YouTubeID(file); ok {
		return FilmQuery{}, false
	}
	name := path.Base(strings.ReplaceAll(file, `\`, "/"))
	name = strings.TrimSuffix(name, path.Ext(name))
	m := yearInName.FindStringSubmatch(name)
	if m == nil {
		return FilmQuery{}, false
	}
	title := strings.Map(func(r rune) rune {
		if r == '.' || r == '_' {
			return ' '
		}
		return r
	}, m[1])
	title = strings.TrimRight(oneLine(title), " -([")
	if !strings.ContainsFunc(title, unicode.IsLetter) {
		return FilmQuery{}, false
	}
	year, err := strconv.Atoi(m[2])
	if err != nil {
		return FilmQuery{}, false
	}
	return FilmQuery{Title: cut(title, MaxDetailsTitle), Year: year}, true
}

// sameTitle says if two titles are the same, apart from capitals, spaces
// and punctuation: "Il Signore degli Anelli - La compagnia dell'anello"
// is "il signore degli anelli la compagnia dellanello".
func sameTitle(a, b string) bool {
	return simple(a) != "" && simple(a) == simple(b)
}

func simple(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return unicode.ToLower(r)
		}
		return -1
	}, s)
}

// FilmHit is one of the films TMDB found for a search.
type FilmHit struct {
	ID            int64
	Title         string
	OriginalTitle string
	ReleaseDate   string // "2006-01-02", or "" when TMDB does not know it
	Picture       string // its best picture, like Film.Picture; "" if none
}

// tmdbSearch are the fields of TMDB's search answer FranzPLAY uses.
type tmdbSearch struct {
	Results []struct {
		ID            int64  `json:"id"`
		Title         string `json:"title"`
		OriginalTitle string `json:"original_title"`
		ReleaseDate   string `json:"release_date"`
		BackdropPath  string `json:"backdrop_path"`
		PosterPath    string `json:"poster_path"`
	} `json:"results"`
}

// ParseTMDBSearch reads TMDB's answer to a search for a film.
func ParseTMDBSearch(data []byte) ([]FilmHit, error) {
	var in tmdbSearch
	if err := json.Unmarshal(data, &in); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrBadDetails, err)
	}
	hits := make([]FilmHit, 0, len(in.Results))
	for _, r := range in.Results {
		if r.ID <= 0 {
			continue
		}
		hits = append(hits, FilmHit{ID: r.ID, Title: oneLine(r.Title), OriginalTitle: oneLine(r.OriginalTitle),
			ReleaseDate: firstDay(r.ReleaseDate), Picture: tmdbBest(r.BackdropPath, r.PosterPath)})
	}
	return hits, nil
}

// Pick returns the film the name of the file means, among what TMDB
// found: the same title, in Italian or in its own language, and the same
// year. Anything less sure is no film at all, so that "Gita al mare
// 2019.mp4" never becomes some unknown film with that name.
func (q FilmQuery) Pick(hits []FilmHit) (FilmHit, bool) {
	for _, h := range hits {
		if !strings.HasPrefix(h.ReleaseDate, strconv.Itoa(q.Year)+"-") {
			continue
		}
		if sameTitle(q.Title, h.Title) || sameTitle(q.Title, h.OriginalTitle) {
			return h, true
		}
	}
	return FilmHit{}, false
}

// Film is what TMDB says about one film.
type Film struct {
	Details
	Picture string // the path of its best picture on TMDB's image server, like "/abc.jpg"; "" if none
}

// tmdbMovie are the fields of TMDB's answer about one film FranzPLAY uses.
type tmdbMovie struct {
	Title        string `json:"title"`
	Overview     string `json:"overview"`
	ReleaseDate  string `json:"release_date"`
	BackdropPath string `json:"backdrop_path"`
	PosterPath   string `json:"poster_path"`
	Credits      struct {
		Crew []struct {
			Job  string `json:"job"`
			Name string `json:"name"`
		} `json:"crew"`
	} `json:"credits"`
}

// tmdbPicture is what a picture's path on TMDB looks like. Anything else
// is not used, so a strange answer can never point somewhere else.
var tmdbPicture = regexp.MustCompile(`^/[A-Za-z0-9_-]+\.(?:jpg|png)$`)

// ParseTMDBMovie reads TMDB's answer about a film, with its credits. The
// author of a film is who directed it. The picture is a wide one, like
// the covers of the videos, or else the poster.
func ParseTMDBMovie(data []byte) (Film, error) {
	var in tmdbMovie
	if err := json.Unmarshal(data, &in); err != nil {
		return Film{}, fmt.Errorf("%w: %w", ErrBadDetails, err)
	}
	var directors []string
	for _, c := range in.Credits.Crew {
		if name := oneLine(c.Name); c.Job == "Director" && name != "" {
			directors = append(directors, name)
		}
	}
	f := Film{Details: Details{
		Title:       cut(oneLine(in.Title), MaxDetailsTitle),
		Description: cleanDescription(in.Overview),
		Author:      cut(strings.Join(directors, ", "), MaxDetailsAuthor),
		Date:        firstDay(in.ReleaseDate),
	}}
	f.Picture = tmdbBest(in.BackdropPath, in.PosterPath)
	return f, nil
}

// tmdbBest returns the first of a film's pictures that is a picture on
// TMDB's image server: the wide one, else the poster.
func tmdbBest(wide, poster string) string {
	for _, p := range []string{wide, poster} {
		if TMDBPicture(p) {
			return p
		}
	}
	return ""
}

// TMDBPicture says if p is the path of a picture on TMDB's image server,
// like "/abc.jpg".
func TMDBPicture(p string) bool {
	return tmdbPicture.MatchString(p)
}
