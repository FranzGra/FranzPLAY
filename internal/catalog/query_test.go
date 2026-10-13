package catalog

import (
	"errors"
	"net/url"
	"reflect"
	"slices"
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
		{"uploader=3", listQuery{uploader: 3, limit: defaultLimit}},
		{"shared=1", listQuery{shared: true, limit: defaultLimit}},
		{"q=%20mare%20%20Rimini%20", listQuery{words: []string{"mare", "Rimini"}, limit: defaultLimit}},
		{"q=%20%20", listQuery{limit: defaultLimit}},
		{"order=newest", listQuery{limit: defaultLimit}},
		{"order=random&seed=42", listQuery{limit: defaultLimit, shuffle: 42}},
		{"order=random&seed=9007199254740991", listQuery{limit: defaultLimit, shuffle: maxSeed}},
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
	for _, query := range []string{"limit=0", "limit=201", "limit=abc", "offset=-1", "offset=x", "uploader=0", "uploader=-2", "uploader=Giulia",
		"q=" + strings.Repeat("a", maxSearchLen+1),
		"order=random", "order=random&seed=0", "order=random&seed=-1", "order=random&seed=x",
		"order=random&seed=9007199254740992", "order=oldest", "seed=42", "order=newest&seed=42",
		"shared=0", "shared=yes", "shared=1&order=random&seed=4"} {
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

func TestValidMadeName(t *testing.T) {
	tests := map[string]bool{
		"12-0a1b2c3d.mp4":   false, // a clip is not an image
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
		// The administrator's choices.
		"12-0a1b2c3d-s30.jpg":          true,
		"12-0a1b2c3d-o89abcdef.jpg":    true,
		"12-0123456789abcdef.jpg":      true,
		"12-0a1b2c3d-s.jpg":            false,
		"12-0a1b2c3d-sx1.jpg":          false,
		"12-0a1b2c3d-x30.jpg":          false,
		"12-0a1b2c3d-oXYZ.jpg":         false,
		"12-0a1b2c3d-o0123456789.jpg":  false,
		"12-0123456789abcdef-s30.jpg":  false,
		"12-0a1b2c3d-s30-s30.jpg":      false,
		"12-0a1b2c3d-s30/../../x.jpg":  false,
		"12-0a1b2c3d-s12345678901.jpg": false,
		// Previews, with the width of their frames.
		"12-0a1b2c3d-w480.jpg":   true,
		"12-0a1b2c3d-w.jpg":      false,
		"12-0a1b2c3d-w48x.jpg":   false,
		"12-0a1b2c3d-w12345.jpg": false,
	}
	for name, want := range tests {
		if got := validMadeName(name, ".jpg"); got != want {
			t.Errorf("validMadeName(%q, .jpg) = %v, want %v", name, got, want)
		}
	}
	clips := map[string]bool{
		"12-0a1b2c3d.mp4":           true,
		"12-0a1b2c3d.jpg":           false,
		".new-123.mp4":              false,
		"12-0a/../../x.mp4":         false,
		"12-0a1b2c3d-o89abcdef.mp4": true,
	}
	for name, want := range clips {
		if got := validMadeName(name, ".mp4"); got != want {
			t.Errorf("validMadeName(%q, .mp4) = %v, want %v", name, got, want)
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

func TestShuffled(t *testing.T) {
	ids := make([]int64, 50)
	for i := range ids {
		ids[i] = int64(i + 1)
	}
	a := shuffled(ids, 7)
	if !slices.Equal(shuffled(ids, 7), a) {
		t.Error("the same seed gave two orders")
	}
	if slices.Equal(a, ids) || slices.Equal(shuffled(ids, 8), a) {
		t.Error("the order is not mixed, or does not depend on the seed")
	}
	if !slices.Equal(slices.Sorted(slices.Values(a)), ids) {
		t.Errorf("mixed %v, want every id once", a)
	}
	if ids[0] != 1 || ids[49] != 50 {
		t.Error("shuffled changed the list it was given")
	}
	if got := shuffled(nil, 7); len(got) != 0 {
		t.Errorf("nothing to mix: %v", got)
	}
}

func TestFileFormat(t *testing.T) {
	tests := map[string]string{
		"mare.mp4": "MP4", "Viaggi/Lago.MKV": "MKV", "clip.m2ts": "M2TS", "a.3gp": "3GP",
		"senza": "", "punto.": "", "strano.mp 4": "", "lungo.abcdefghijk": "", "àccento.mövie": "",
	}
	for name, want := range tests {
		if got := fileFormat(name); got != want {
			t.Errorf("fileFormat(%q) = %q, want %q", name, got, want)
		}
	}
}
