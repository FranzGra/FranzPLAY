package main

import (
	"bytes"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestHostileBodiesNeverBreakTheServer sends bodies made to hurt to every
// address that reads one, as the administrator (who gets furthest): none
// may answer 500, and the server must still be there after.
func TestHostileBodiesNeverBreakTheServer(t *testing.T) {
	if testing.Short() {
		t.Skip("starts the whole program")
	}
	s := startLiveSite(t)
	bodies := map[string][]byte{
		"cut halfway":       []byte(`{"name": "x`),
		"a list":            []byte(`[1, 2, 3]`),
		"a string":          []byte(`"hello"`),
		"deeply nested":     []byte(strings.Repeat("[", 100000) + strings.Repeat("]", 100000)),
		"one huge field":    []byte(`{"name": "` + strings.Repeat("é", 1<<20) + `"}`),
		"many fields":       []byte("{" + strings.Repeat(`"a": 1, `, 50000) + `"b": 2}`),
		"not utf-8":         {0xff, 0xfe, 0xfd, '{', '}'},
		"a nul":             []byte("{\x00}"),
		"huge number":       []byte(`{"id": 1` + strings.Repeat("0", 5000) + `}`),
		"wrong types":       []byte(`{"name": 5, "password": true, "role": [], "open": "yes", "enabled": "no"}`),
		"two objects":       []byte(`{} {}`),
		"only spaces":       []byte("   \n\t  "),
		"a binary blob":     bytes.Repeat([]byte{0, 1, 2, 3, 250, 251}, 100000),
		"keys with escapes": []byte(`{"name": "\ud800", "\u0000": 1}`),
	}
	for _, route := range registeredRoutes(t) {
		method, pattern, _ := strings.Cut(route, " ")
		if method == http.MethodGet || route == "POST /api/logout" || route == "DELETE /api/me" {
			continue // nothing to read; logging out or leaving would end the test
		}
		path := fill(t, pattern)
		for name, body := range bodies {
			a := s.do(s.admin, method, path, body)
			if a.status >= 500 {
				t.Errorf("%s with %s: %d %s", route, name, a.status, a.body)
			}
		}
	}
	// Leaving with a body that is not the password never leaves.
	for name, body := range bodies {
		if a := s.do(s.user, "DELETE", "/api/me", body); a.status < 400 || a.status >= 500 {
			t.Errorf("DELETE /api/me with %s: %d %s", name, a.status, a.body)
		}
	}
	s.expect(s.user, "GET", "/api/me", nil, http.StatusOK)
	s.alive()
}

// TestFileAddressesStayInTheirFolder asks the addresses that send a file
// for names that try to climb out of their folder. A file planted next to
// the database must never come back, whatever the trick.
func TestFileAddressesStayInTheirFolder(t *testing.T) {
	if testing.Short() {
		t.Skip("starts the whole program")
	}
	s := startLiveSite(t)
	const secret = "franzplay-canary-7c1e"
	for _, dir := range []string{s.dataDir, filepath.Dir(s.dataDir)} {
		if err := os.WriteFile(filepath.Join(dir, "canary.jpg"), []byte(secret), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	addresses := []string{
		"/api/covers/", "/api/previews/", "/api/clips/", "/api/clips-hd/",
		"/api/category-images/", "/api/category-pictures/", "/api/videos/1/subtitles/",
		"/api/public/AAAAAAAAAAAAAAAAAAAAAA/subtitles/",
	}
	var names []string
	for depth := 1; depth <= 6; depth++ {
		up := strings.Repeat("../", depth)
		names = append(names,
			strings.ReplaceAll(up, "/", "%2F")+"canary.jpg",
			strings.ReplaceAll(up, "/", "%5C")+"canary.jpg",
			strings.ReplaceAll(up, "../", "%2E%2E%2F")+"canary.jpg",
			strings.ReplaceAll(up, "../", "..%252F")+"canary.jpg",
			strings.ReplaceAll(up, "../", "....%2F%2F")+"canary.jpg",
		)
	}
	names = append(names,
		"%2Fetc%2Fpasswd", "..", "%2E%2E", "canary.jpg%00.jpg", "C:%5CWindows%5Cwin.ini",
		"%2F%2Fserver%2Fshare%2Fcanary.jpg", strings.Repeat("a", 5000)+".jpg",
		filepath.ToSlash(filepath.Join(s.dataDir, "canary.jpg")),
		strings.ReplaceAll(filepath.ToSlash(filepath.Join(s.dataDir, "canary.jpg")), "/", "%2F"),
	)
	for _, base := range addresses {
		for _, name := range names {
			for _, cookie := range []string{"", s.user, s.admin} {
				a := s.do(cookie, "GET", base+name, nil)
				if a.status >= 500 || (a.status >= 200 && a.status < 300) {
					t.Errorf("GET %s%s = %d", base, name, a.status)
				}
				if bytes.Contains(a.body, []byte(secret)) || bytes.Contains(a.body, []byte("root:")) {
					t.Errorf("GET %s%s gave a file from outside: %.80q", base, name, a.body)
				}
				// The server may send to the cleaned path: what is there
				// must not be the file either.
				if loc := a.header.Get("Location"); loc != "" && strings.HasPrefix(loc, "/") {
					if b := s.do(cookie, "GET", loc, nil); bytes.Contains(b.body, []byte(secret)) {
						t.Errorf("GET %s%s, sent to %s, gave the file from outside", base, name, loc)
					}
				}
			}
		}
	}
	s.alive()
}

// TestStrangeHeaders: cookies, hosts and proxies that do not make sense
// are refused or ignored, never trusted.
func TestStrangeHeaders(t *testing.T) {
	if testing.Short() {
		t.Skip("starts the whole program")
	}
	s := startLiveSite(t)
	for name, cookie := range map[string]string{
		"too long":         strings.Repeat("a", 101),
		"a real one, cut":  s.admin[:len(s.admin)-1],
		"a real one, more": s.admin + "x",
		"sql":              "' OR 1=1 --",
		"spaces":           "   ",
	} {
		if a := s.do(cookie, "GET", "/api/me", nil); a.status != http.StatusUnauthorized {
			t.Errorf("cookie %s: %d, want 401", name, a.status)
		}
	}
	// Two cookies: the first is the one read, as browsers send the most
	// specific first. A wrong first one is not saved by a right second one.
	a := s.do("", "GET", "/api/me", nil, "Cookie", "franzplay_session=wrong; franzplay_session="+s.admin)
	if a.status != http.StatusUnauthorized {
		t.Errorf("wrong cookie then right one: %d, want 401", a.status)
	}

	// Changing something from another site, however it is dressed up.
	change := func(header ...string) answer {
		return s.do(s.admin, "PUT", "/api/me/color", map[string]string{"color": "#123456"}, header...)
	}
	for name, header := range map[string][]string{
		"another site":          {"Origin", "https://evil.example"},
		"null origin":           {"Origin", "null"},
		"same host, other port": {"Origin", strings.Replace(s.base, "127.0.0.1:", "127.0.0.1:1", 1)},
		"not an address":        {"Origin", "http://[::1"},
		"forwarded elsewhere":   {"Origin", "https://evil.example", "X-Forwarded-Host", "play.example.org"},
	} {
		if a := change(header...); a.status != http.StatusForbidden {
			t.Errorf("%s: %d, want 403", name, a.status)
		}
	}
	if a := change("Origin", strings.ToUpper(s.base)); a.status != http.StatusNoContent && a.status != http.StatusOK {
		t.Errorf("own origin in capitals: %d %s", a.status, a.body)
	}
	// Reading is always allowed: a link from another site opens the page.
	if a := s.do(s.admin, "GET", "/api/me", nil, "Origin", "https://evil.example"); a.status != http.StatusOK {
		t.Errorf("GET with another origin: %d", a.status)
	}

	// Headers too large are refused by the server before any handler.
	if a := s.do(s.admin, "GET", "/api/me", nil, "X-Big", strings.Repeat("a", 2<<20)); a.status != http.StatusRequestHeaderFieldsTooLarge {
		t.Errorf("2 MB of headers: %d, want 431", a.status)
	}
	// A made-up X-Forwarded-For from a direct connection changes nothing.
	if a := s.do(s.admin, "GET", "/api/me", nil, "X-Forwarded-For", "garbage, , 300.1.1.1"); a.status != http.StatusOK {
		t.Errorf("garbage X-Forwarded-For: %d", a.status)
	}
	s.alive()
}
