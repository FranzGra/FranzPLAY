package video

import (
	"errors"
	"testing"
)

func TestYouTubeID(t *testing.T) {
	tests := []struct {
		file, want string
		ok         bool
	}{
		{"Gita in montagna [dQw4w9WgXcQ].mp4", "dQw4w9WgXcQ", true},
		{"canale/sub/Video [a-b_c1234XY].mkv", "a-b_c1234XY", true},
		{`C:\video\Mare [dQw4w9WgXcQ].webm`, "dQw4w9WgXcQ", true},
		{"[dQw4w9WgXcQ] cartella/mare.mp4", "", false}, // only the file's own name
		{"Mare [dQw4w9WgXcQ] copia.mp4", "", false},    // not at the end
		{"Natale [2019].mp4", "", false},               // not a YouTube code
		{"Mare [dQw4w9WgXcQX].mp4", "", false},         // one letter too many
		{"Mare [dQw4w9WgXc!].mp4", "", false},          // a sign YouTube never uses
		{"mare.mp4", "", false},
	}
	for _, tt := range tests {
		got, ok := YouTubeID(tt.file)
		if got != tt.want || ok != tt.ok {
			t.Errorf("YouTubeID(%q) = %q, %v; want %q, %v", tt.file, got, ok, tt.want, tt.ok)
		}
	}
}

func TestParseOEmbed(t *testing.T) {
	got, err := ParseOEmbed([]byte(`{"title": "Gita\nin montagna", "author_name": "Famiglia Rossi",
		"type": "video", "thumbnail_url": "https://i.ytimg.com/vi/x/hqdefault.jpg"}`))
	if err != nil {
		t.Fatal(err)
	}
	if want := (Details{Title: "Gita in montagna", Author: "Famiglia Rossi"}); got != want {
		t.Errorf("ParseOEmbed = %+v, want %+v", got, want)
	}
	if _, err := ParseOEmbed([]byte(`<html>`)); !errors.Is(err, ErrBadDetails) {
		t.Errorf("error = %v, want ErrBadDetails", err)
	}
}
