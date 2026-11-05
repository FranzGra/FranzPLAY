package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// The settings of the whole site are checked by the server, whatever the
// interface lets people type: these tests send what the interface never
// would, through the real program.

func TestSiteLookIsCheckedByTheServer(t *testing.T) {
	if testing.Short() {
		t.Skip("starts the whole program")
	}
	s := startLiveSite(t)
	look := func() string {
		return string(s.expect("", "GET", "/api/site", nil, http.StatusOK).body)
	}
	before := look()
	for name, body := range map[string]string{
		"first part empty":    `{"nameFirst": "", "nameSecond": "PLAY", "color": "#2997ff"}`,
		"17 letters":          `{"nameFirst": "abcdefghijklmnopq", "nameSecond": "", "color": "#2997ff"}`,
		"17 accented letters": `{"nameFirst": "` + strings.Repeat("è", 17) + `", "nameSecond": "", "color": "#2997ff"}`,
		"17 emoji":            `{"nameFirst": "` + strings.Repeat("🎬", 17) + `", "nameSecond": "", "color": "#2997ff"}`,
		"a new line":          `{"nameFirst": "Franz\nPLAY", "nameSecond": "", "color": "#2997ff"}`,
		"a tab in the second": `{"nameFirst": "Franz", "nameSecond": "P\tLAY", "color": "#2997ff"}`,
		"a nul":               `{"nameFirst": "Fra\u0000nz", "nameSecond": "", "color": "#2997ff"}`,
		"html in the color":   `{"nameFirst": "Franz", "nameSecond": "", "color": "#2997ff\"><script>"}`,
		"css in the color":    `{"nameFirst": "Franz", "nameSecond": "", "color": "red;background:url(x)"}`,
		"three digits":        `{"nameFirst": "Franz", "nameSecond": "", "color": "#fff"}`,
		"rgb()":               `{"nameFirst": "Franz", "nameSecond": "", "color": "rgb(0,0,0)"}`,
		"round covers":        `{"nameFirst": "Franz", "nameSecond": "", "color": "#2997ff", "categoryShape": "round"}`,
		"shape in capitals":   `{"nameFirst": "Franz", "nameSecond": "", "color": "#2997ff", "categoryShape": "SQUARE"}`,
		"a field more":        `{"nameFirst": "Franz", "nameSecond": "", "color": "#2997ff", "admin": true}`,
		"a number for a name": `{"nameFirst": 5, "nameSecond": "", "color": "#2997ff"}`,
		"more than 4 KB":      `{"nameFirst": "Franz", "nameSecond": "` + strings.Repeat(" ", 5000) + `", "color": "#2997ff"}`,
		"nothing":             ``,
	} {
		if a := s.do(s.admin, "PUT", "/api/site", body); a.status != http.StatusBadRequest {
			t.Errorf("%s: %d %s, want 400", name, a.status, a.body)
		}
	}
	if after := look(); after != before {
		t.Fatalf("a refused change was saved: %s, was %s", after, before)
	}

	// At the limits, accepted and tidied.
	a := s.expect(s.admin, "PUT", "/api/site",
		`{"nameFirst": " `+strings.Repeat("🎬", 16)+` ", "nameSecond": "Città", "color": "#ABCDEF", "categoryShape": " square "}`,
		http.StatusOK)
	var got struct{ NameFirst, NameSecond, Color, CategoryShape string }
	if err := json.Unmarshal(a.body, &got); err != nil {
		t.Fatal(err)
	}
	if got.NameFirst != strings.Repeat("🎬", 16) || got.NameSecond != "Città" || got.Color != "#abcdef" || got.CategoryShape != "square" {
		t.Errorf("saved %+v", got)
	}
	// Everybody reads it, even before logging in; only the administrator writes it.
	if !strings.Contains(look(), `"color":"#abcdef"`) {
		t.Errorf("GET /api/site = %s", look())
	}
	if a := s.do(s.user, "PUT", "/api/site", `{"nameFirst": "Mio", "nameSecond": "", "color": "#000000"}`); a.status != http.StatusForbidden {
		t.Errorf("a person: %d", a.status)
	}
	if a := s.do("", "PUT", "/api/site", `{"nameFirst": "Mio", "nameSecond": "", "color": "#000000"}`); a.status != http.StatusUnauthorized {
		t.Errorf("nobody: %d", a.status)
	}
	s.alive()
}

func TestClipSettingsAreCheckedByTheServer(t *testing.T) {
	if testing.Short() {
		t.Skip("starts the whole program")
	}
	s := startLiveSite(t)
	const path = "/api/admin/clip-settings"
	before := string(s.expect(s.admin, "GET", path, nil, http.StatusOK).body)
	for _, body := range []string{
		`{"startPercent": -1, "seconds": 5}`,
		`{"startPercent": 96, "seconds": 5}`,
		`{"startPercent": 10, "seconds": 1}`,
		`{"startPercent": 10, "seconds": 31}`,
		`{"startPercent": 10, "seconds": 0}`,
		`{"startPercent": 10}`,
		`{"seconds": 5}`,
		`{"startPercent": 10.5, "seconds": 5}`,
		`{"startPercent": 10, "seconds": 99999999999999999999}`,
		`{"startPercent": "10", "seconds": 5}`,
		`{"startPercent": null, "seconds": 5}`,
		`{"startPercent": 10, "seconds": 5, "more": 1}`,
		`[10, 5]`,
	} {
		if a := s.do(s.admin, "PUT", path, body); a.status != http.StatusBadRequest {
			t.Errorf("PUT %s = %d %s, want 400", body, a.status, a.body)
		}
	}
	if after := string(s.expect(s.admin, "GET", path, nil, http.StatusOK).body); after != before {
		t.Fatalf("a refused change was saved: %s, was %s", after, before)
	}
	// The limits themselves are allowed.
	for _, body := range []string{`{"startPercent": 0, "seconds": 2}`, `{"startPercent": 95, "seconds": 30}`} {
		a := s.expect(s.admin, "PUT", path, body, http.StatusOK)
		if got := string(s.expect(s.admin, "GET", path, nil, http.StatusOK).body); got != string(a.body) {
			t.Errorf("after PUT %s: GET = %s, PUT answered %s", body, got, a.body)
		}
	}
	s.alive()
}

func TestTitleRulesAreCheckedByTheServer(t *testing.T) {
	if testing.Short() {
		t.Skip("starts the whole program")
	}
	s := startLiveSite(t)
	const path = "/api/admin/title-rules"
	read := func() string {
		var page struct{ Settings json.RawMessage }
		if err := json.Unmarshal(s.expect(s.admin, "GET", path, nil, http.StatusOK).body, &page); err != nil {
			t.Fatal(err)
		}
		return string(page.Settings)
	}
	before := read()
	rule := func(find, replace string, regex bool) map[string]any {
		return map[string]any{"find": find, "replace": replace, "regex": regex, "on": true}
	}
	rules := func(r ...map[string]any) map[string]any { return map[string]any{"rules": r, "categories": false} }
	many := make([]map[string]any, 31)
	for i := range many {
		many[i] = rule("x", "", false)
	}
	for name, body := range map[string]any{
		"31 rules":            rules(many...),
		"nothing to find":     rules(rule("", "y", false)),
		"201 letters to find": rules(rule(strings.Repeat("é", 201), "", false)),
		"201 to put":          rules(rule("x", strings.Repeat("é", 201), false)),
		"two lines":           rules(rule("a\nb", "", false)),
		"a broken regex":      rules(rule("(unclosed", "", true)),
		"a huge repeat":       rules(rule("(a{1000}){1000}", "", true)),
		"a field more":        map[string]any{"rules": []any{}, "categories": false, "admin": true},
		"more than 64 KB":     rules(rule(strings.Repeat("x", 70<<10), "", false)),
	} {
		if a := s.do(s.admin, "PUT", path, body); a.status != http.StatusBadRequest {
			t.Errorf("%s: %d %s, want 400", name, a.status, a.body)
		}
		if a := s.do(s.admin, "POST", path+"/preview", map[string]any{"settings": body, "names": []string{"a"}}); a.status != http.StatusBadRequest {
			t.Errorf("preview, %s: %d %s, want 400", name, a.status, a.body)
		}
	}
	if after := read(); after != before {
		t.Fatalf("a refused change was saved: %s, was %s", after, before)
	}

	// The preview tries a few short names only.
	ok := rules(rule("_", " ", false))
	names := make([]string, 21)
	for i := range names {
		names[i] = "a_b.mp4"
	}
	if a := s.do(s.admin, "POST", path+"/preview", map[string]any{"settings": ok, "names": names}); a.status != http.StatusBadRequest {
		t.Errorf("21 names: %d", a.status)
	}
	if a := s.do(s.admin, "POST", path+"/preview", map[string]any{"settings": ok, "names": []string{strings.Repeat("é", 256)}}); a.status != http.StatusBadRequest {
		t.Errorf("a name of 256 letters: %d", a.status)
	}
	// A rule that grows the name everywhere cannot make it huge.
	greedy := rules(rule("", strings.Repeat("W", 200), true))
	greedy["rules"] = []map[string]any{rule("(?:)", strings.Repeat("W", 200), true)}
	a := s.do(s.admin, "POST", path+"/preview", map[string]any{"settings": greedy, "names": []string{strings.Repeat("a", 255)}})
	if a.status == http.StatusOK && len(a.body) > 4<<10 {
		t.Errorf("a growing rule made a title of %d bytes", len(a.body))
	} else if a.status >= 500 {
		t.Errorf("a growing rule: %d %s", a.status, a.body)
	}

	// Saved, the rules make the titles again at once.
	saved := s.expect(s.admin, "PUT", path, rules(rule("mare", "Il mare", false)), http.StatusOK)
	var got struct{ Changed int }
	if err := json.Unmarshal(saved.body, &got); err != nil || got.Changed != 1 {
		t.Errorf("saved: %s %v, want 1 video changed", saved.body, err)
	}
	if !strings.Contains(string(s.expect(s.user, "GET", "/api/videos", nil, http.StatusOK).body), "Il mare") {
		t.Error("the new title is not in the list")
	}
	s.alive()
}
