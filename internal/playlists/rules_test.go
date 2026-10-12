package playlists

import (
	"errors"
	"strings"
	"testing"
)

func TestCleanName(t *testing.T) {
	tests := []struct{ in, want string }{
		{"Vacanze", "Vacanze"},
		{"  Estate   2024 ", "Estate 2024"},
		{"Riga\nnuova\ttab", "Riga nuova tab"},
		{"Ciao\x00mondo", "Ciao mondo"},
		{"Città è già", "Città è già"},
		{strings.Repeat("è", maxNameLen), strings.Repeat("è", maxNameLen)},
	}
	for _, tt := range tests {
		got, err := cleanName(tt.in)
		if err != nil || got != tt.want {
			t.Errorf("cleanName(%q) = %q, %v, want %q", tt.in, got, err, tt.want)
		}
	}
}

func TestCleanNameRefuses(t *testing.T) {
	for _, in := range []string{"", "   ", "\n\t", "\xff", strings.Repeat("a", maxNameLen+1)} {
		if _, err := cleanName(in); !errors.Is(err, errBadName) {
			t.Errorf("cleanName(%q): %v, want errBadName", in, err)
		}
	}
}
