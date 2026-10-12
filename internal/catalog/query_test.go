package catalog

import (
	"errors"
	"net/url"
	"reflect"
	"strings"
	"testing"
)

func TestParseListQuery(t *testing.T) {
	tests := []struct {
		query string
		want  listQuery
	}{
		{"", listQuery{limit: defaultLimit}},
		{"category=Viaggi&limit=10&offset=20", listQuery{category: "Viaggi", limit: 10, offset: 20}},
		{"category=%20Corsi%20", listQuery{category: "Corsi", limit: defaultLimit}},
		{"limit=200", listQuery{limit: 200}},
		{"q=%20mare%20%20Rimini%20", listQuery{words: []string{"mare", "Rimini"}, limit: defaultLimit}},
		{"q=%20%20", listQuery{limit: defaultLimit}},
	}
	for _, tt := range tests {
		values, err := url.ParseQuery(tt.query)
		if err != nil {
			t.Fatal(err)
		}
		got, err := parseListQuery(values)
		if err != nil {
			t.Errorf("%q: %v", tt.query, err)
			continue
		}
		if !reflect.DeepEqual(got, tt.want) {
			t.Errorf("%q: got %+v, want %+v", tt.query, got, tt.want)
		}
	}
}

func TestParseListQueryRejects(t *testing.T) {
	for _, query := range []string{"limit=0", "limit=201", "limit=abc", "offset=-1", "offset=x",
		"q=" + strings.Repeat("a", maxSearchLen+1)} {
		values, err := url.ParseQuery(query)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := parseListQuery(values); !errors.Is(err, errBadQuery) {
			t.Errorf("%q: error = %v, want errBadQuery", query, err)
		}
	}
}

func TestParseID(t *testing.T) {
	tests := map[string]bool{"1": true, "42": true, "0": false, "-3": false, "x": false, "": false, "9999999999999999999999": false}
	for s, want := range tests {
		if _, got := parseID(s); got != want {
			t.Errorf("parseID(%q) ok = %v, want %v", s, got, want)
		}
	}
}

func TestValidCoverName(t *testing.T) {
	tests := map[string]bool{
		"12-0a1b2c3d.jpg":   true,
		"1-f.jpg":           true,
		"../franzplay.db":   false,
		"12-0a1b2c3d.png":   false,
		"12-0A1B2C3D.jpg":   false,
		"12-0a1b2c3d9.jpg":  false,
		"x-0a1b2c3d.jpg":    false,
		"12-.jpg":           false,
		".new-123.jpg":      false,
		"12-0a/../../x.jpg": false,
	}
	for name, want := range tests {
		if got := validImageName(name); got != want {
			t.Errorf("validImageName(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestContentType(t *testing.T) {
	tests := map[string]string{".mp4": "video/mp4", ".WEBM": "video/webm", ".mkv": "video/x-matroska", ".xyz": "application/octet-stream"}
	for ext, want := range tests {
		if got := contentType(ext); got != want {
			t.Errorf("contentType(%q) = %q, want %q", ext, got, want)
		}
	}
}

func TestSearchWords(t *testing.T) {
	tests := map[string][]string{
		"":                      nil,
		"   ":                   nil,
		"mare":                  {"mare"},
		" mare  Rimini ":        {"mare", "Rimini"},
		"mare MARE Mare rimini": {"mare", "rimini"},
		"a b c d e f g h i j k": {"a", "b", "c", "d", "e", "f", "g", "h"},
		"città\tdi\nmare":       {"città", "di", "mare"},
	}
	for search, want := range tests {
		if got := searchWords(search); !reflect.DeepEqual(got, want) {
			t.Errorf("searchWords(%q) = %q, want %q", search, got, want)
		}
	}
}

func TestLikePattern(t *testing.T) {
	tests := map[string]string{
		"mare": "%mare%",
		"50%":  `%50\%%`,
		"a_b":  `%a\_b%`,
		`c:\x`: `%c:\\x%`,
	}
	for word, want := range tests {
		if got := likePattern(word); got != want {
			t.Errorf("likePattern(%q) = %q, want %q", word, got, want)
		}
	}
}
