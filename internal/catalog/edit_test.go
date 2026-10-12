package catalog

import (
	"net/http"
	"strconv"
	"strings"
	"testing"
)

func ptr(s string) *string { return &s }

func TestCleanTitleAndCategory(t *testing.T) {
	tests := []struct {
		name     string
		in       *string
		title    *string // want for cleanTitle; nil with titleOK = back to found
		titleOK  bool
		category *string
		catOK    bool
	}{
		{"null puts back the found one", nil, nil, true, nil, true},
		{"spaces around removed", ptr("  Gita al mare "), ptr("Gita al mare"), true, ptr("Gita al mare"), true},
		{"empty", ptr("   "), nil, false, ptr(""), true}, // a video may have no category
		{"two lines", ptr("Gita\nal mare"), nil, false, nil, false},
		{"long", ptr(strings.Repeat("a", maxTitle+1)), nil, false, nil, false},
		{"accents count as one letter", ptr(strings.Repeat("è", maxCategory)),
			ptr(strings.Repeat("è", maxCategory)), true, ptr(strings.Repeat("è", maxCategory)), true},
	}
	same := func(a, b *string) bool { return (a == nil && b == nil) || (a != nil && b != nil && *a == *b) }
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := cleanTitle(tt.in)
			if (err == nil) != tt.titleOK || (err == nil && !same(got, tt.title)) {
				t.Errorf("cleanTitle = %v, %v", got, err)
			}
			got, err = cleanCategory(tt.in)
			if (err == nil) != tt.catOK || (err == nil && !same(got, tt.category)) {
				t.Errorf("cleanCategory = %v, %v", got, err)
			}
		})
	}
}

func TestAdministratorChangesTitleAndCategory(t *testing.T) {
	s := newAdminSite(t)
	id := s.addVideo(t, "Viaggi/mare.mp4", "sea", "Viaggi", 100, true)
	address := "/api/admin/videos/" + strconv.FormatInt(id, 10) + "/details"

	s.do(t, "PUT", address, `{"title": " Estate 2024 ", "category": "Vacanze"}`, http.StatusNoContent)
	v := decode[adminList](t, s.do(t, "GET", "/api/admin/videos", "", http.StatusOK)).Videos[0]
	if v.Title != "Estate 2024" || v.Category != "Vacanze" || !v.TitleSet || !v.CategorySet ||
		v.FoundTitle != "mare.mp4" || v.FoundCategory != "Viaggi" {
		t.Fatalf("after the change: %+v", v)
	}
	// Everybody sees the new ones, and the category lists follow.
	cats := decode[[]Category](t, s.get(t, "/api/categories"))
	if len(cats) != 1 || cats[0].Name != "Vacanze" {
		t.Errorf("categories = %+v", cats)
	}
	// A rescan does not undo the change: it writes only what it finds.
	if _, err := s.db.Exec(`UPDATE videos SET title = 'mare.mp4', folder_category = 'Viaggi' WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	v = decode[adminList](t, s.do(t, "GET", "/api/admin/videos", "", http.StatusOK)).Videos[0]
	if v.Title != "Estate 2024" || v.Category != "Vacanze" {
		t.Errorf("after a rescan: %+v", v)
	}

	// No category at all, and the found title back.
	s.do(t, "PUT", address, `{"title": null, "category": ""}`, http.StatusNoContent)
	v = decode[adminList](t, s.do(t, "GET", "/api/admin/videos", "", http.StatusOK)).Videos[0]
	if v.Title != "mare.mp4" || v.Category != "" || v.TitleSet || !v.CategorySet {
		t.Errorf("found title, no category: %+v", v)
	}
	// Both back as found.
	s.do(t, "PUT", address, `{}`, http.StatusNoContent)
	v = decode[adminList](t, s.do(t, "GET", "/api/admin/videos", "", http.StatusOK)).Videos[0]
	if v.Category != "Viaggi" || v.CategorySet {
		t.Errorf("found category back: %+v", v)
	}
	if s.changed == 0 {
		t.Error("the open pages were not told")
	}
}

func TestDetailsRefusals(t *testing.T) {
	s := newAdminSite(t)
	id := s.addVideo(t, "a.mp4", "a", "", 1, true)
	address := "/api/admin/videos/" + strconv.FormatInt(id, 10) + "/details"
	for _, body := range []string{
		`{"title": ""}`,
		`{"title": "a\nb"}`,
		`{"category": "` + strings.Repeat("x", maxCategory+1) + `"}`,
		`{"title": "ok", "path": "/etc"}`,
		`nope`,
	} {
		s.do(t, "PUT", address, body, http.StatusBadRequest)
	}
	s.do(t, "PUT", "/api/admin/videos/999/details", `{"title": "x"}`, http.StatusNotFound)
	s.who.Role = "user"
	s.do(t, "PUT", address, `{"title": "x"}`, http.StatusForbidden)
}
