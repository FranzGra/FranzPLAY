package library

import "testing"

func TestIsVideo(t *testing.T) {
	tests := map[string]bool{
		"film.mp4":      true,
		"FILM.MKV":      true,
		"clip.webm":     true,
		"old.avi":       true,
		"notes.txt":     false,
		"cover.jpg":     false,
		"subs.srt":      false,
		"film.mp4.part": false,
		"._film.mp4":    false, // macOS metadata file
		".hidden.mp4":   false,
		"mp4":           false,
		"":              false,
	}
	for name, want := range tests {
		if got := isVideo(name); got != want {
			t.Errorf("isVideo(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestSkipDir(t *testing.T) {
	tests := map[string]bool{
		"Viaggi":                    false,
		"2025":                      false,
		"@eaDir":                    true,
		"#recycle":                  true,
		"$RECYCLE.BIN":              true,
		"System Volume Information": true,
		".git":                      true,
		".Trashes":                  true,
	}
	for name, want := range tests {
		if got := skipDir(name); got != want {
			t.Errorf("skipDir(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestTitleAndCategory(t *testing.T) {
	tests := []struct {
		relPath, title, category string
	}{
		{"mare.mp4", "mare", ""},
		{"Viaggi/Sardegna 2025.mp4", "Sardegna 2025", "Viaggi"},
		{"Viaggi/2025/agosto/mare.mkv", "mare", "Viaggi"},
		{"Corsi/Go. Lezione 3.mp4", "Go. Lezione 3", "Corsi"},
	}
	for _, tt := range tests {
		if got := titleOf(tt.relPath); got != tt.title {
			t.Errorf("titleOf(%q) = %q, want %q", tt.relPath, got, tt.title)
		}
		if got := categoryOf(tt.relPath); got != tt.category {
			t.Errorf("categoryOf(%q) = %q, want %q", tt.relPath, got, tt.category)
		}
	}
}
