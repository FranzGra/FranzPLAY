package site

import (
	"strings"
	"testing"
)

func TestClean(t *testing.T) {
	tests := []struct {
		name string
		in   Look
		want Look
		ok   bool
	}{
		{"the default", Default, Default, true},
		{"spaces around, color in capitals", Look{" Casa ", " Rossi ", " #DC2626 ", ""}, Look{"Casa", "Rossi", "#dc2626", "landscape"}, true},
		{"second part may be empty", Look{"Cinema", "", "#2997ff", ""}, Look{"Cinema", "", "#2997ff", "landscape"}, true},
		{"accents count as one letter", Look{"Città", strings.Repeat("è", maxNamePart), "#2997ff", ""},
			Look{"Città", strings.Repeat("è", maxNamePart), "#2997ff", "landscape"}, true},
		{"first part empty", Look{"  ", "PLAY", "#2997ff", ""}, Look{}, false},
		{"part too long", Look{strings.Repeat("a", maxNamePart+1), "", "#2997ff", ""}, Look{}, false},
		{"two lines", Look{"Franz\nPLAY", "", "#2997ff", ""}, Look{}, false},
		{"color without #", Look{"Franz", "PLAY", "2997ff", ""}, Look{}, false},
		{"short color", Look{"Franz", "PLAY", "#fff", ""}, Look{}, false},
		{"color name", Look{"Franz", "PLAY", "red", ""}, Look{}, false},
		{"something hidden in the color", Look{"Franz", "PLAY", "#2997ff;x", ""}, Look{}, false},
		{"a square cover", Look{"Franz", "PLAY", "#2997ff", " square "}, Look{"Franz", "PLAY", "#2997ff", "square"}, true},
		{"a cover shape that does not exist", Look{"Franz", "PLAY", "#2997ff", "round"}, Look{}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.in.Clean()
			if (err == nil) != tt.ok {
				t.Fatalf("Clean(%+v) error = %v, want ok %v", tt.in, err, tt.ok)
			}
			if got != tt.want {
				t.Errorf("Clean(%+v) = %+v, want %+v", tt.in, got, tt.want)
			}
		})
	}
}
