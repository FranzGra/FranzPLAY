package recommend

import (
	"slices"
	"testing"
)

func TestSimilar(t *testing.T) {
	sea := Video{ID: 1, Title: "Mare in Sardegna", Category: "Vacanze", AddedAt: 100}
	tests := []struct {
		name     string
		all      []Video
		together map[int64]int
		finished map[int64]bool
		limit    int
		want     []Pick
	}{
		{
			name: "same category first, then the newest",
			all: []Video{
				sea,
				{ID: 2, Title: "Compleanno", Category: "Feste", AddedAt: 300},
				{ID: 3, Title: "Montagna", Category: "Vacanze", AddedAt: 200},
			},
			limit: 10,
			want:  []Pick{{3, SameCategory}, {2, Newest}},
		},
		{
			name: "people who watched both count more than the category",
			all: []Video{
				sea,
				{ID: 2, Title: "Compleanno", Category: "Feste", AddedAt: 300},
				{ID: 3, Title: "Montagna", Category: "Vacanze", AddedAt: 200},
			},
			together: map[int64]int{2: 2},
			limit:    10,
			want:     []Pick{{2, WatchedTogether}, {3, SameCategory}},
		},
		{
			name: "words in common in the title, ignoring small and common words",
			all: []Video{
				sea,
				{ID: 2, Title: "Il video della festa", AddedAt: 300},
				{ID: 3, Title: "Sardegna, giorno 2", AddedAt: 200},
			},
			limit: 10,
			want:  []Pick{{3, SimilarTitle}, {2, Newest}},
		},
		{
			name: "videos already watched to the end go last",
			all: []Video{
				sea,
				{ID: 2, Title: "Compleanno", Category: "Feste", AddedAt: 300},
				{ID: 3, Title: "Montagna", Category: "Vacanze", AddedAt: 200},
			},
			finished: map[int64]bool{3: true},
			limit:    10,
			want:     []Pick{{2, Newest}, {3, SameCategory}},
		},
		{
			name: "no more than the limit",
			all: []Video{
				sea,
				{ID: 2, Title: "A", AddedAt: 300},
				{ID: 3, Title: "B", AddedAt: 200},
			},
			limit: 1,
			want:  []Pick{{2, Newest}},
		},
		{
			name:  "nothing else to suggest",
			all:   []Video{sea},
			limit: 10,
			want:  []Pick{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Similar(sea, tt.all, tt.together, tt.finished, tt.limit)
			if !slices.Equal(got, tt.want) {
				t.Errorf("Similar = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSimilarNeverChangesOrderForEqualVideos(t *testing.T) {
	all := []Video{{ID: 1}, {ID: 2, AddedAt: 5}, {ID: 3, AddedAt: 5}, {ID: 4, AddedAt: 5}}
	want := []Pick{{4, Newest}, {3, Newest}, {2, Newest}}
	for range 5 {
		slices.Reverse(all)
		if got := Similar(Video{ID: 1}, all, nil, nil, 10); !slices.Equal(got, want) {
			t.Fatalf("Similar = %v, want %v", got, want)
		}
	}
}

func TestForYou(t *testing.T) {
	all := []Video{
		{ID: 1, Title: "Mare", Category: "Vacanze", AddedAt: 100},
		{ID: 2, Title: "Montagna", Category: "Vacanze", AddedAt: 200},
		{ID: 3, Title: "Compleanno", Category: "Feste", AddedAt: 300},
		{ID: 4, Title: "Senza categoria", AddedAt: 400},
	}
	tests := []struct {
		name   string
		taste  Taste
		others map[int64]int
		limit  int
		want   []Pick
	}{
		{
			name:  "nothing known: nothing to suggest",
			limit: 10,
			want:  []Pick{},
		},
		{
			name:  "the categories the person likes, without what they already saw",
			taste: Taste{Categories: map[string]int{"Vacanze": 2}, Known: map[int64]bool{1: true}},
			limit: 10,
			want:  []Pick{{2, YourCategory}},
		},
		{
			name:   "what the others watched",
			others: map[int64]int{3: 1, 4: 2},
			limit:  10,
			want:   []Pick{{4, Popular}, {3, Popular}},
		},
		{
			name:   "both together, best first",
			taste:  Taste{Categories: map[string]int{"Vacanze": 1, "Feste": 5}},
			others: map[int64]int{1: 3},
			limit:  10,
			want:   []Pick{{3, YourCategory}, {1, Popular}, {2, YourCategory}},
		},
		{
			name:   "no more than the limit",
			others: map[int64]int{1: 1, 2: 1, 3: 1},
			limit:  2,
			want:   []Pick{{3, Popular}, {2, Popular}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ForYou(all, tt.taste, tt.others, tt.limit)
			if !slices.Equal(got, tt.want) {
				t.Errorf("ForYou = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestTitleWords(t *testing.T) {
	got := titleWords("Natale 2019 — il video DELLA Nonna (parte 2)")
	want := map[string]bool{"natale": true, "2019": true, "nonna": true}
	if len(got) != len(want) {
		t.Fatalf("titleWords = %v, want %v", got, want)
	}
	for w := range want {
		if !got[w] {
			t.Errorf("titleWords = %v, missing %q", got, w)
		}
	}
}
