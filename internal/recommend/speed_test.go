package recommend

import (
	"fmt"
	"testing"
)

// bigLibrary is n videos with realistic titles in a few categories.
func bigLibrary(n int) []Video {
	words := []string{"Gita", "mare", "festa", "cena", "partita", "lezione", "intervista", "concerto",
		"prova", "ricetta", "allenamento", "viaggio", "della", "nonna", "2023"}
	all := make([]Video, n)
	for i := range all {
		all[i] = Video{
			ID:       int64(i + 1),
			Title:    fmt.Sprintf("%s %s %s %05d", words[i%len(words)], words[(i/3)%len(words)], words[(i/7)%len(words)], i),
			Category: fmt.Sprintf("Categoria %d", i%12),
			AddedAt:  int64(i),
		}
	}
	return all
}

// BenchmarkSimilar10000 is the suggestions next to the player with 10,000
// videos: it runs every time a video page opens.
func BenchmarkSimilar10000(b *testing.B) {
	all := bigLibrary(10000)
	together := map[int64]int{5: 2, 9: 1}
	for b.Loop() {
		Similar(all[42], all, together, nil, 20)
	}
}

// BenchmarkForYou10000 is the "Potrebbe piacerti" row of the Home.
func BenchmarkForYou10000(b *testing.B) {
	all := bigLibrary(10000)
	taste := Taste{Categories: map[string]int{"Categoria 1": 3, "Categoria 5": 1}, Known: map[int64]bool{3: true}}
	others := map[int64]int{7: 2, 11: 1}
	for b.Loop() {
		ForYou(all, taste, others, 12)
	}
}

func TestSharedWords(t *testing.T) {
	tests := []struct {
		of, title string
		want      int
	}{
		{"Gita al mare 2024", "Mare d'inverno", 1},
		{"Gita al mare 2024", "MARE, mare e ancora mare", 1}, // each word once
		{"Gita al mare 2024", "Gita al mare 2024", 3},        // 2024 counts too
		{"Lezione uno: le basi della chitarra", "Chitarra: lezione due, le basi", 3},
		{"Gita al mare", "Montagna", 0},
		{"Il re", "Il re", 0},                     // short words never count
		{"Città d'arte", "Le città più belle", 1}, // letters beyond A–Z
		{"Concerto", "Concerto finale concerto", 1},
		{"", "Qualsiasi titolo", 0},
	}
	for _, tt := range tests {
		if got := sharedWords(titleWords(tt.of), tt.title); got != tt.want {
			t.Errorf("sharedWords(%q, %q) = %d, want %d", tt.of, tt.title, got, tt.want)
		}
	}
}

// The suggestions next to the player stay light: a guard that, unlike a
// time, gives the same number on every computer. Today about 1,600
// allocations for 10,000 videos, almost all the titles in small letters.
func TestSimilarStaysLight(t *testing.T) {
	all := bigLibrary(10000)
	allocs := testing.AllocsPerRun(3, func() {
		Similar(all[42], all, map[int64]int{5: 2}, nil, 20)
	})
	if allocs > 3000 {
		t.Errorf("Similar with 10,000 videos made %.0f allocations, want at most 3,000", allocs)
	}
}
