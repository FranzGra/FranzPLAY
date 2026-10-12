package users

import "testing"

func TestCleanName(t *testing.T) {
	for _, tc := range []struct {
		in, want string
		ok       bool
	}{
		{"Giulia", "Giulia", true},
		{"  Giulia  ", "Giulia", true},
		{"Niccolò", "Niccolò", true},
		{"Zia Anna", "Zia Anna", true},
		{"mario.rossi_2-b", "mario.rossi_2-b", true},
		{"ab", "", false},
		{"   ab   ", "", false},
		{"Zia  Anna", "", false},
		{"<script>", "", false},
		{"a/b/c", "", false},
		{"emoji😀ok", "", false},
		{"abcdefghijklmnopqrstuvwxyzabcdef", "abcdefghijklmnopqrstuvwxyzabcdef", true},
		{"abcdefghijklmnopqrstuvwxyzabcdefg", "", false},
	} {
		got, err := CleanName(tc.in)
		if (err == nil) != tc.ok || got != tc.want {
			t.Errorf("cleanName(%q) = %q, %v; want %q, ok=%v", tc.in, got, err, tc.want, tc.ok)
		}
	}
}

func TestParseRole(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want Role
		ok   bool
	}{
		{"admin", Admin, true},
		{"user", User, true},
		{"Admin", "", false},
		{"root", "", false},
		{"", "", false},
	} {
		got, ok := parseRole(tc.in)
		if got != tc.want || ok != tc.ok {
			t.Errorf("parseRole(%q) = %q, %v", tc.in, got, ok)
		}
	}
}
