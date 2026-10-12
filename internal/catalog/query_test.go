package catalog

import (
	"errors"
	"net/url"
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
		if got != tt.want {
			t.Errorf("%q: got %+v, want %+v", tt.query, got, tt.want)
		}
	}
}

func TestParseListQueryRejects(t *testing.T) {
	for _, query := range []string{"limit=0", "limit=201", "limit=abc", "offset=-1", "offset=x"} {
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
		if got := validCoverName(name); got != want {
			t.Errorf("validCoverName(%q) = %v, want %v", name, got, want)
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
