package video

import (
	"errors"
	"strings"
	"testing"
)

func TestFilmInName(t *testing.T) {
	tests := []struct {
		file string
		want FilmQuery
		ok   bool
	}{
		{"Il sorpasso (1962).mkv", FilmQuery{"Il sorpasso", 1962}, true},
		{"film/The.Matrix.1999.1080p.BluRay.mkv", FilmQuery{"The Matrix", 1999}, true},
		{`D:\Film\La_vita_è_bella_1997.mp4`, FilmQuery{"La vita è bella", 1997}, true},
		{"2001.A.Space.Odyssey.1968.mkv", FilmQuery{"2001 A Space Odyssey", 1968}, true}, // the last year
		{"Blade Runner 2049 (2017).mkv", FilmQuery{"Blade Runner 2049", 2017}, true},
		{"Up [2009].mkv", FilmQuery{"Up", 2009}, true},
		{"Amici miei - 1975 - ITA.avi", FilmQuery{"Amici miei", 1975}, true},
		{"Gita al mare 2019.mp4", FilmQuery{"Gita al mare", 2019}, true}, // a question; only an exact answer counts
		{"1917 (2019).mp4", FilmQuery{}, false},                          // no letters: too unsure to be a title
		{"mare.mp4", FilmQuery{}, false},
		{"Natale1999.mp4", FilmQuery{}, false},              // the year is not on its own
		{"Ricordi 1850.mp4", FilmQuery{}, false},            // not a year of films
		{"1999.mp4", FilmQuery{}, false},                    // only a year
		{"Gita 2019 [dQw4w9WgXcQ].mp4", FilmQuery{}, false}, // saved from YouTube
		{"2010/mare.mp4", FilmQuery{}, false},               // only the file's own name
	}
	for _, tt := range tests {
		got, ok := FilmInName(tt.file)
		if got != tt.want || ok != tt.ok {
			t.Errorf("FilmInName(%q) = %+v, %v; want %+v, %v", tt.file, got, ok, tt.want, tt.ok)
		}
	}
}

func TestFilmQueryPick(t *testing.T) {
	hits := []FilmHit{
		{ID: 1, Title: "Il sorpasso", OriginalTitle: "Il sorpasso", ReleaseDate: "2020-01-01"}, // a remake
		{ID: 2, Title: "Il Sorpasso!", OriginalTitle: "Il sorpasso", ReleaseDate: "1962-12-05"},
		{ID: 3, Title: "Il sorpasso", OriginalTitle: "Il sorpasso", ReleaseDate: "1962-01-01"},
	}
	tests := []struct {
		name string
		q    FilmQuery
		hits []FilmHit
		want int64
	}{
		{"same title and year, the first one", FilmQuery{"il sorpasso", 1962}, hits, 2},
		{"the original title", FilmQuery{"Matrix", 1999},
			[]FilmHit{{ID: 7, Title: "Matrix Reloaded", OriginalTitle: "The Matrix", ReleaseDate: "1999-03-30"},
				{ID: 8, Title: "Matrice", OriginalTitle: "Matrix", ReleaseDate: "1999-03-30"}}, 8},
		{"another year", FilmQuery{"Il sorpasso", 1963}, hits, 0},
		{"a title that only looks like it", FilmQuery{"Il sorpasso 2", 1962}, hits, 0},
		{"no date known", FilmQuery{"Gita al mare", 2019},
			[]FilmHit{{ID: 9, Title: "Gita al mare"}}, 0},
		{"nothing found", FilmQuery{"Gita al mare", 2019}, nil, 0},
	}
	for _, tt := range tests {
		got, ok := tt.q.Pick(tt.hits)
		if got.ID != tt.want || ok != (tt.want != 0) {
			t.Errorf("%s: Pick = %d, %v; want %d", tt.name, got.ID, ok, tt.want)
		}
	}
}

func TestParseTMDBSearch(t *testing.T) {
	got, err := ParseTMDBSearch([]byte(`{"page": 1, "results": [
		{"id": 11, "title": "Il\nsorpasso", "original_title": "Il sorpasso", "release_date": "1962-12-05", "adult": false,
			"backdrop_path": null, "poster_path": "/tall.jpg"},
		{"id": 0, "title": "senza codice"},
		{"id": 12, "title": "Senza data", "release_date": ""}
	]}`))
	if err != nil {
		t.Fatal(err)
	}
	want := []FilmHit{
		{ID: 11, Title: "Il sorpasso", OriginalTitle: "Il sorpasso", ReleaseDate: "1962-12-05", Picture: "/tall.jpg"},
		{ID: 12, Title: "Senza data"},
	}
	if len(got) != len(want) {
		t.Fatalf("ParseTMDBSearch = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("hit %d = %+v, want %+v", i, got[i], want[i])
		}
	}
	if _, err := ParseTMDBSearch([]byte(`<html>`)); !errors.Is(err, ErrBadDetails) {
		t.Errorf("error = %v, want ErrBadDetails", err)
	}
}

func TestParseTMDBMovie(t *testing.T) {
	tests := []struct {
		name string
		data string
		want Film
	}{
		{
			name: "directors are the author, the wide picture first",
			data: `{"title": "Il sorpasso", "overview": "Due uomini in viaggio.\r\n\r\n\r\nFino al mare.",
				"release_date": "1962-12-05", "backdrop_path": "/wide_1.jpg", "poster_path": "/tall.jpg",
				"credits": {"cast": [{"name": "Vittorio Gassman"}], "crew": [
					{"job": "Producer", "name": "Mario Cecchi Gori"},
					{"job": "Director", "name": "Dino Risi"},
					{"job": "Director", "name": " "},
					{"job": "Director", "name": "Altro Regista"}]}}`,
			want: Film{Details: Details{Title: "Il sorpasso", Description: "Due uomini in viaggio.\n\nFino al mare.",
				Author: "Dino Risi, Altro Regista", Date: "1962-12-05"}, Picture: "/wide_1.jpg"},
		},
		{
			name: "only the poster",
			data: `{"title": "Corto", "backdrop_path": null, "poster_path": "/p-2.png"}`,
			want: Film{Details: Details{Title: "Corto"}, Picture: "/p-2.png"},
		},
		{
			name: "a picture path that could point somewhere else is not used",
			data: `{"title": "Strano", "backdrop_path": "/../../evil.jpg", "poster_path": "https://evil.example/x.jpg"}`,
			want: Film{Details: Details{Title: "Strano"}},
		},
		{
			name: "a date that is not real is dropped",
			data: `{"title": "Futuro", "release_date": "2026-02-30"}`,
			want: Film{Details: Details{Title: "Futuro"}},
		},
	}
	for _, tt := range tests {
		got, err := ParseTMDBMovie([]byte(tt.data))
		if err != nil {
			t.Fatalf("%s: %v", tt.name, err)
		}
		if got != tt.want {
			t.Errorf("%s:\n got %+v\nwant %+v", tt.name, got, tt.want)
		}
	}

	long, err := ParseTMDBMovie([]byte(`{"title": "` + strings.Repeat("a", 500) + `"}`))
	if err != nil || len([]rune(long.Title)) != MaxDetailsTitle {
		t.Errorf("long title: %d characters, %v", len([]rune(long.Title)), err)
	}
	if _, err := ParseTMDBMovie([]byte(`[]`)); !errors.Is(err, ErrBadDetails) {
		t.Errorf("error = %v, want ErrBadDetails", err)
	}
}
