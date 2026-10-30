package online

import "testing"

func TestMatchPercent(t *testing.T) {
	for _, tt := range []struct {
		name, video, title, date string
		want                     int
	}{
		{name: "the same", video: "Il sorpasso", title: "Il sorpasso", want: 100},
		{name: "capitals and punctuation", video: "IL SORPASSO!", title: "il... sorpasso", want: 100},
		{name: "accents", video: "Perché no", title: "Perche no", want: 100},
		{name: "joined words", video: "Spider-Man", title: "Spiderman", want: 100},
		{name: "order of the words", video: "Sorpasso, Il", title: "Il sorpasso", want: 100},
		{name: "zeros of a number", video: "Mare 02", title: "Mare 2", want: 100},
		{name: "a word that announces a number", video: "Mare parte 2", title: "Mare 2", want: 100},
		{name: "season and episode", video: "Mare S01E03", title: "Mare 1 episodio 3", want: 100},
		{name: "number glued to its word", video: "Mare ep03", title: "Mare 3", want: 100},
		{name: "a word without its number stays", video: "La parte", title: "La", want: 67},
		{name: "another number is another part", video: "Mare 2", title: "Mare 3", want: 50},
		{name: "half the words", video: "Mare d'estate", title: "Mare 2024", want: 40},
		{name: "the year of the answer counts", video: "Il sorpasso 1962", title: "Il sorpasso", date: "1962-12-05", want: 100},
		{name: "another year does not", video: "Il sorpasso 1962", title: "Il sorpasso", date: "2001-01-01", want: 80},
		{name: "nothing in common", video: "Gita", title: "Il sorpasso", want: 0},
		{name: "a misspelled word is another word", video: "Sorpasso", title: "Sorpaso", want: 0},
		{name: "no words", video: "...", title: "...", want: 0},
		{name: "no title", video: "Gita", title: "", want: 0},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := matchPercent(tt.video, tt.title, tt.date); got != tt.want {
				t.Errorf("matchPercent(%q, %q, %q) = %d, want %d", tt.video, tt.title, tt.date, got, tt.want)
			}
		})
	}
}
