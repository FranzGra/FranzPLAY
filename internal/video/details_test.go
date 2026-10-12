package video

import (
	"errors"
	"strings"
	"testing"
)

func TestParseInfoJSON(t *testing.T) {
	tests := []struct {
		name string
		data string
		want Details
	}{
		{
			name: "a file written by yt-dlp",
			data: `{"id": "abc123", "title": "Gita in montagna", "description": "Una bella giornata.\nCon tutti.",
				"channel": "Famiglia Rossi", "uploader": "rossi", "upload_date": "20190315",
				"formats": [{"format_id": "18"}]}`,
			want: Details{Title: "Gita in montagna", Description: "Una bella giornata.\nCon tutti.",
				Author: "Famiglia Rossi", Date: "2019-03-15"},
		},
		{
			name: "the uploader when there is no channel",
			data: `{"title": "Mare", "uploader": "Giulia"}`,
			want: Details{Title: "Mare", Author: "Giulia"},
		},
		{
			name: "text cleaned: one line, no control characters",
			data: `{"title": "  Natale\n\t2019\u0007  ", "channel": "Nonna\r\nMaria"}`,
			want: Details{Title: "Natale 2019", Author: "Nonna Maria"},
		},
		{
			name: "description: Windows lines, tabs, many empty lines",
			data: `{"description": "\n\nPrima riga\r\n\tseconda  \n\n\n\nfine\u0000\n\n"}`,
			want: Details{Description: "Prima riga\n seconda\n\nfine"},
		},
		{
			name: "dates that are not real days are dropped",
			data: `{"upload_date": "20190230"}`,
			want: Details{},
		},
		{
			name: "dates too far away are dropped",
			data: `{"upload_date": "18000101"}`,
			want: Details{},
		},
		{
			name: "fields of the wrong kind are not there",
			data: `{"title": null}`,
			want: Details{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseInfoJSON([]byte(tt.data))
			if err != nil {
				t.Fatal(err)
			}
			if got != tt.want {
				t.Errorf("ParseInfoJSON = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestParseInfoJSONCutsLongText(t *testing.T) {
	long := strings.Repeat("è", MaxDescription+10)
	got, err := ParseInfoJSON([]byte(`{"title": "` + long + `", "description": "` + long + `", "channel": "` + long + `"}`))
	if err != nil {
		t.Fatal(err)
	}
	for name, field := range map[string]struct {
		text string
		max  int
	}{"title": {got.Title, MaxDetailsTitle}, "description": {got.Description, MaxDescription}, "author": {got.Author, MaxDetailsAuthor}} {
		if n := len([]rune(field.text)); n != field.max {
			t.Errorf("%s: %d characters, want %d", name, n, field.max)
		}
	}
}

func TestParseInfoJSONRefusesWhatIsNotOne(t *testing.T) {
	for _, data := range []string{``, `not json`, `[1, 2]`, `{"title": 5}`} {
		if _, err := ParseInfoJSON([]byte(data)); !errors.Is(err, ErrBadDetails) {
			t.Errorf("%q: error %v, want ErrBadDetails", data, err)
		}
	}
}
