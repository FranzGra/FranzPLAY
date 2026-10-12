package users

import (
	"errors"
	"testing"
)

func TestParseColor(t *testing.T) {
	tests := []struct {
		in   string
		want Color
		err  error
	}{
		{"#dc2626", "#dc2626", nil},
		{"#DC2626", "#dc2626", nil},
		{" #7c3aed ", "#7c3aed", nil},
		{"", "", nil},
		{"dc2626", "", errBadColor},
		{"#dc262", "", errBadColor},
		{"#dc26266", "", errBadColor},
		{"#gggggg", "", errBadColor},
		{"red", "", errBadColor},
		{"#dc2626;}", "", errBadColor},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			got, err := parseColor(tt.in)
			if got != tt.want || !errors.Is(err, tt.err) {
				t.Fatalf("parseColor(%q) = %q, %v; want %q, %v", tt.in, got, err, tt.want, tt.err)
			}
		})
	}
}
