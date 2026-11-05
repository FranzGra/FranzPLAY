package users

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"testing"
	"time"
)

// sessionExpiry reads when the only session of the database ends.
func sessionExpiry(t *testing.T, s *site) time.Time {
	t.Helper()
	var at int64
	if err := s.db.QueryRow(`SELECT expires_at FROM sessions`).Scan(&at); err != nil {
		t.Fatal(err)
	}
	return time.Unix(at, 0)
}

func TestSessionEndsExactlyThirtyDaysAfterItsLastUse(t *testing.T) {
	s := newSite(t)
	b := s.setUp()
	start := s.now
	if got := sessionExpiry(t, s); !got.Equal(start.Add(sessionLife)) {
		t.Fatalf("a new session ends at %v, want %v", got, start.Add(sessionLife))
	}
	// Unused, the last second still works: that use starts thirty days again.
	s.now = start.Add(sessionLife - time.Second)
	expect(t, b.do("GET", "/api/me", nil), http.StatusOK)
	used := s.now
	s.now = used.Add(sessionLife - time.Second)
	expect(t, b.do("GET", "/api/me", nil), http.StatusOK)
	// Unused again: at the very second it ends, it is over.
	used = s.now
	s.now = used.Add(sessionLife)
	expect(t, b.do("GET", "/api/me", nil), http.StatusUnauthorized)
}

func TestSessionIsWrittenDownAtMostOnceAnHour(t *testing.T) {
	s := newSite(t)
	b := s.setUp()
	start := s.now
	for _, after := range []time.Duration{time.Minute, 30 * time.Minute, touchEvery - time.Second} {
		s.now = start.Add(after)
		expect(t, b.do("GET", "/api/me", nil), http.StatusOK)
		if got := sessionExpiry(t, s); !got.Equal(start.Add(sessionLife)) {
			t.Fatalf("used after %v: the session was written again (ends %v)", after, got)
		}
	}
	s.now = start.Add(touchEvery)
	expect(t, b.do("GET", "/api/me", nil), http.StatusOK)
	if got := sessionExpiry(t, s); !got.Equal(s.now.Add(sessionLife)) {
		t.Fatalf("used after an hour: ends %v, want %v", got, s.now.Add(sessionLife))
	}
}

// The cleaning done at every start (NewService) removes the sessions that
// are over and keeps the others. It is called here with the test's clock:
// NewService uses the real one.
func TestExpiredSessionsAreForgotten(t *testing.T) {
	s := newSite(t)
	s.setUp() // a session at start
	s.now = s.now.Add(sessionLife / 2)
	recent := s.browser()
	expect(t, recent.do("POST", "/api/login", map[string]string{"name": "Admin", "password": "admin-password"}), http.StatusOK)

	later := s.now.Add(sessionLife/2 + time.Hour) // the first is over, the second is not
	if err := s.svc.store.deleteExpiredSessions(context.Background(), later); err != nil {
		t.Fatal(err)
	}
	var left int
	if err := s.db.QueryRow(`SELECT count(*) FROM sessions`).Scan(&left); err != nil || left != 1 {
		t.Fatalf("sessions left = %d (%v), want the recent one", left, err)
	}
	s.now = later
	expect(t, recent.do("GET", "/api/me", nil), http.StatusOK)
}

func TestSessionsFollowTheAccountAtOnce(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	for _, name := range []string{"Luca", "Marta"} {
		expect(t, admin.do("POST", "/api/users", map[string]any{"name": name, "password": "password-of-" + name, "role": "admin"}),
			http.StatusCreated)
	}
	luca, marta := s.browser(), s.browser()
	expect(t, luca.do("POST", "/api/login", map[string]string{"name": "Luca", "password": "password-of-Luca"}), http.StatusOK)
	expect(t, marta.do("POST", "/api/login", map[string]string{"name": "Marta", "password": "password-of-Marta"}), http.StatusOK)
	expect(t, luca.do("GET", "/api/users", nil), http.StatusOK)

	// No longer an administrator: the open session knows at its next request.
	expect(t, admin.do("PUT", "/api/users/"+itoa(whoAmI(t, luca).ID), map[string]any{"role": "user"}), http.StatusOK)
	expect(t, luca.do("GET", "/api/users", nil), http.StatusForbidden)
	expect(t, luca.do("GET", "/api/me", nil), http.StatusOK)

	// Deleted: the open session ends.
	id := whoAmI(t, marta).ID
	expect(t, admin.do("DELETE", "/api/users/"+itoa(id), nil), http.StatusNoContent)
	expect(t, marta.do("GET", "/api/me", nil), http.StatusUnauthorized)
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM sessions WHERE user_id = ?`, id).Scan(&n); err != nil || n != 0 {
		t.Errorf("sessions of a deleted user: %d, %v", n, err)
	}
}

// cookieOf returns the session cookie an answer sets.
func cookieOf(t *testing.T, rec *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	for _, c := range rec.Result().Cookies() {
		if c.Name == cookieName {
			return c
		}
	}
	t.Fatalf("no cookie in %v", rec.Header())
	return nil
}

func TestSessionCookieAttributes(t *testing.T) {
	for _, tc := range []struct {
		name   string
		header []string
		secure bool
	}{
		{"plain http", nil, false},
		{"https proxy", []string{"X-Forwarded-Proto", "https"}, true},
		{"https proxy in capitals", []string{"X-Forwarded-Proto", "HTTPS"}, true},
		{"http proxy", []string{"X-Forwarded-Proto", "http"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := newSite(t)
			b := s.browser()
			setup := b.do("POST", "/api/setup", map[string]string{"name": "Admin", "password": "admin-password"}, tc.header...)
			expect(t, setup, http.StatusCreated)
			login := s.browser().do("POST", "/api/login", map[string]string{"name": "Admin", "password": "admin-password"}, tc.header...)
			expect(t, login, http.StatusOK)
			for what, rec := range map[string]*httptest.ResponseRecorder{"setup": setup, "login": login} {
				c := cookieOf(t, rec)
				if !c.HttpOnly || c.SameSite != http.SameSiteLaxMode || c.Secure != tc.secure || c.Path != "/" ||
					c.MaxAge != int(sessionLife.Seconds()) || len(c.Value) < 40 {
					t.Errorf("%s cookie = %+v", what, c)
				}
			}
			logout := b.do("POST", "/api/logout", nil, tc.header...)
			expect(t, logout, http.StatusNoContent)
			if c := cookieOf(t, logout); c.MaxAge >= 0 || c.Value != "" || !c.HttpOnly || c.Secure != tc.secure {
				t.Errorf("logout cookie = %+v", c)
			}
		})
	}
}

func TestLogoutWithoutASessionStillClearsTheCookie(t *testing.T) {
	s := newSite(t)
	s.setUp()
	b := s.browser()
	b.cookie = "a-session-that-does-not-exist"
	// A session that is over (expired, or ended elsewhere): logout still
	// answers it worked and clears the cookie, so the browser forgets it.
	cleared := func(rec *httptest.ResponseRecorder) {
		t.Helper()
		expect(t, rec, http.StatusNoContent)
		if c := cookieOf(t, rec); c.MaxAge >= 0 || c.Value != "" {
			t.Errorf("logout cookie = %+v, want it cleared", c)
		}
	}
	cleared(b.do("POST", "/api/logout", nil))
	// No cookie at all: the same.
	cleared(s.browser().do("POST", "/api/logout", nil))
	// Logging out twice with the same cookie: the second time it is gone.
	b = s.browser()
	expect(t, b.do("POST", "/api/login", map[string]string{"name": "Admin", "password": "admin-password"}), http.StatusOK)
	old := b.cookie
	cleared(b.do("POST", "/api/logout", nil))
	b.cookie = old
	cleared(b.do("POST", "/api/logout", nil))
	// The rest of the API stays closed to that cookie.
	expect(t, b.do("GET", "/api/users", nil), http.StatusUnauthorized)
}

func TestLoginBodiesThatAreNotForms(t *testing.T) {
	s := newSite(t)
	s.setUp()
	for name, body := range map[string]string{
		"more than 4 KB":   `{"name": "Admin", "password": "` + strings.Repeat("a", 5000) + `"}`,
		"a list":           `["Admin", "admin-password"]`,
		"a field more":     `{"name": "Admin", "password": "admin-password", "role": "admin"}`,
		"numbers":          `{"name": 1, "password": 2}`,
		"cut":              `{"name": "Admin", "password": "admin-pass`,
		"empty":            ``,
		"null":             `null`,
		"name with a nul":  `{"name": "Ad\u0000min", "password": "admin-password"}`,
		"sql in the name":  `{"name": "' OR 1=1 --", "password": "admin-password"}`,
		"like in the name": `{"name": "%", "password": "admin-password"}`,
	} {
		rec := httptest.NewRecorder()
		s.handler.ServeHTTP(rec, httptest.NewRequest("POST", "/api/login", strings.NewReader(body)))
		if rec.Code == http.StatusOK || rec.Code >= 500 {
			t.Errorf("%s: %d %s", name, rec.Code, rec.Body)
		}
		if len(rec.Result().Cookies()) != 0 {
			t.Errorf("%s: a cookie was given", name)
		}
	}
	// None of them blocked the administrator.
	expect(t, s.browser().do("POST", "/api/login", map[string]string{"name": "Admin", "password": "admin-password"}), http.StatusOK)
}

func TestNamesWithAccentsAndEmojiLogIn(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	for _, name := range []string{"Nicolò", "Zoë_2", "Ångström", "Παύλος", "Олег"} {
		expect(t, admin.do("POST", "/api/users", map[string]any{"name": name, "password": "a-good-password", "role": "user"}),
			http.StatusCreated)
		b := s.browser()
		rec := b.do("POST", "/api/login", map[string]string{"name": " " + name + " ", "password": "a-good-password"})
		expect(t, rec, http.StatusOK)
		if got := whoAmI(t, b).Name; got != name {
			t.Errorf("logged in as %q, want %q", got, name)
		}
	}
}

func TestNamesAreTheSameWhateverTheCase(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	// Plain letters: "Giulia" and "giulia" are one person.
	expect(t, admin.do("POST", "/api/users", map[string]any{"name": "Giulia", "password": "a-good-password", "role": "user"}),
		http.StatusCreated)
	expect(t, admin.do("POST", "/api/users", map[string]any{"name": "GIULIA", "password": "a-good-password", "role": "user"}),
		http.StatusConflict)
	expect(t, s.browser().do("POST", "/api/login", map[string]string{"name": "giulia", "password": "a-good-password"}),
		http.StatusOK)

	// Accented letters too: COLLATE NOCASE folds only A-Z, the rest is
	// compared in Go (sameName).
	expect(t, admin.do("POST", "/api/users", map[string]any{"name": "Élodie", "password": "a-good-password", "role": "user"}),
		http.StatusCreated)
	expect(t, admin.do("POST", "/api/users", map[string]any{"name": "élodie", "password": "a-good-password", "role": "user"}),
		http.StatusConflict)
	expect(t, s.browser().do("POST", "/api/login", map[string]string{"name": "élodie", "password": "a-good-password"}),
		http.StatusOK)
}

func TestManyLoginsAtOnceAllGetIn(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	const people = 12
	for i := range people {
		expect(t, admin.do("POST", "/api/users", map[string]any{
			"name": fmt.Sprintf("Persona %d", i), "password": "password-number-" + itoa(int64(i)), "role": "user",
		}), http.StatusCreated)
	}
	var wg sync.WaitGroup
	codes := make([]int, people)
	for i := range people {
		wg.Go(func() {
			codes[i] = s.browser().do("POST", "/api/login", map[string]string{
				"name": fmt.Sprintf("Persona %d", i), "password": "password-number-" + itoa(int64(i)),
			}, "RemoteAddr", fmt.Sprintf("198.51.100.%d:5000", i+1)).Code
		})
	}
	wg.Wait()
	for i, code := range codes {
		if code != http.StatusOK {
			t.Errorf("Persona %d: %d", i, code)
		}
	}
}

// Behind a trusted proxy each person is blocked by their own address,
// never by the proxy's: a stranger's wrong tries do not lock out the
// others who come through the same proxy.
func TestTrustedProxyBlocksThePersonNotTheProxy(t *testing.T) {
	s := newSite(t)
	s.setUp()
	s.svc.SetTrustedProxies([]netip.Prefix{netip.MustParsePrefix("172.18.0.0/16")})
	proxy := "172.18.0.2:40000"
	try := func(name, password, from string, header ...string) *httptest.ResponseRecorder {
		h := append([]string{"RemoteAddr", proxy, "X-Forwarded-For", from}, header...)
		return s.browser().do("POST", "/api/login", map[string]string{"name": name, "password": password}, h...)
	}
	stranger := "203.0.113.66"
	for i := range addressPolicy.threshold {
		try(fmt.Sprintf("nome%02d", i), "wrong-password", stranger)
	}
	expect(t, try("Admin", "admin-password", stranger), http.StatusTooManyRequests)
	// Through the same proxy, from another address: in.
	expect(t, try("Admin", "admin-password", "198.51.100.20"), http.StatusOK)
	// The stranger cannot pretend to be someone else by writing the header
	// first: the proxy adds the real address at the end.
	expect(t, try("Admin", "admin-password", "198.51.100.21, "+stranger), http.StatusTooManyRequests)

	// The access log has the person's address, not the proxy's.
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM logins WHERE address = ?`, stranger).Scan(&n); err != nil || n == 0 {
		t.Errorf("logins from the stranger's address: %d, %v", n, err)
	}
	if err := s.db.QueryRow(`SELECT count(*) FROM logins WHERE address LIKE '172.18.%'`).Scan(&n); err != nil || n != 0 {
		t.Errorf("logins with the proxy's address: %d, %v", n, err)
	}

	// Someone outside, not the proxy, who writes the header: their own
	// address counts, and the header is ignored.
	direct := "198.51.100.99:5000"
	for i := range addressPolicy.threshold {
		s.browser().do("POST", "/api/login", map[string]string{"name": fmt.Sprintf("altro%02d", i), "password": "wrong-password"},
			"RemoteAddr", direct, "X-Forwarded-For", "198.51.100.20")
	}
	expect(t, try("Admin", "admin-password", "198.51.100.20"), http.StatusOK)
}

func TestRealAddressInStrangeCases(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("10.0.0.1/32"), netip.MustParsePrefix("fd00::/8")}
	tests := []struct {
		name      string
		remote    string
		forwarded []string
		want      string
	}{
		{"IPv6 connection", "[2001:db8::1]:443", nil, "2001:db8::1"},
		{"IPv6 trusted proxy", "[fd00::5]:443", []string{"2001:db8::7"}, "2001:db8::7"},
		{"no port", "10.0.0.1", []string{"198.51.100.7"}, "198.51.100.7"},
		{"IPv4 written as IPv6", "10.0.0.1:1", []string{"::ffff:198.51.100.7"}, "198.51.100.7"},
		{"proxy written as IPv6", "[::ffff:10.0.0.1]:1", []string{"198.51.100.7"}, "198.51.100.7"},
		{"two header lines", "10.0.0.1:1", []string{"1.2.3.4", "198.51.100.7"}, "198.51.100.7"},
		{"spaces and empty hops", "10.0.0.1:1", []string{" 198.51.100.7 ,"}, "10.0.0.1"},
		{"only proxies", "10.0.0.1:1", []string{"10.0.0.1, fd00::9"}, "10.0.0.1"},
		{"a port in the header", "10.0.0.1:1", []string{"198.51.100.7:5555"}, "10.0.0.1"},
		{"a zone", "10.0.0.1:1", []string{"fe80::1%eth0"}, "fe80::1%eth0"},
		{"not an address at all", "pipe", []string{"198.51.100.7"}, "pipe"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest("POST", "/api/login", nil)
			r.RemoteAddr = tt.remote
			for _, h := range tt.forwarded {
				r.Header.Add("X-Forwarded-For", h)
			}
			if got := realAddr(r, trusted); got != tt.want {
				t.Errorf("realAddr = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestOriginsThatAreNotThisSite(t *testing.T) {
	s := newSite(t)
	b := s.setUp()
	color := map[string]string{"color": "#123456"}
	for _, tc := range []struct {
		name   string
		header []string
		want   int
	}{
		{"own page", []string{"Origin", "http://example.com"}, http.StatusOK},
		{"own page in capitals", []string{"Origin", "HTTP://EXAMPLE.COM"}, http.StatusOK},
		{"a sandboxed frame", []string{"Origin", "null"}, http.StatusForbidden},
		{"same name, other port", []string{"Origin", "http://example.com:8080"}, http.StatusForbidden},
		{"a name that ends the same", []string{"Origin", "http://evil-example.com"}, http.StatusForbidden},
		{"a name that starts the same", []string{"Origin", "http://example.com.evil.net"}, http.StatusForbidden},
		{"user and password", []string{"Origin", "http://example.com@evil.net"}, http.StatusForbidden},
		{"not an address", []string{"Origin", "http://[::1"}, http.StatusForbidden},
		// X-Forwarded-Host wins over Forwarded: a proxy that sets both is
		// believed for the first.
		{"both proxy headers", []string{"Origin", "https://evil.example", "X-Forwarded-Host", "play.example.org",
			"Forwarded", "host=evil.example"}, http.StatusForbidden},
		{"forwarded, quoted, with a port", []string{"Origin", "https://play.example.org:8443",
			"Forwarded", `for=10.0.0.1;host="play.example.org:8443"`}, http.StatusOK},
		{"empty forwarded host", []string{"Origin", "https://evil.example", "X-Forwarded-Host", ""}, http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, method := range []string{"PUT", "DELETE", "PATCH"} {
				path := "/api/me/color"
				want := tc.want
				if method != "PUT" {
					path = "/api/me/avatar"
					if method == "PATCH" {
						path = "/api/me"
					}
					if want != http.StatusForbidden {
						continue // only the refusal is the same for every method
					}
				}
				if rec := b.do(method, path, color, tc.header...); rec.Code != want {
					t.Errorf("%s %s: %d, want %d", method, path, rec.Code, want)
				}
			}
		})
	}
	expect(t, b.do("GET", "/api/me", nil, "Origin", "null"), http.StatusOK)
}

func TestMeShowsNothingSecret(t *testing.T) {
	s := newSite(t)
	b := s.setUp()
	rec := b.do("GET", "/api/me", nil)
	expect(t, rec, http.StatusOK)
	var fields map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &fields); err != nil {
		t.Fatal(err)
	}
	for key := range fields {
		lower := strings.ToLower(key)
		if strings.Contains(lower, "hash") || strings.Contains(lower, "password") || strings.Contains(lower, "token") ||
			strings.Contains(lower, "session") || strings.Contains(lower, "secret") {
			t.Errorf("/api/me shows %s", key)
		}
	}
	if strings.Contains(rec.Body.String(), b.cookie) || strings.Contains(rec.Body.String(), "$argon2") {
		t.Errorf("/api/me = %s", rec.Body)
	}
	// Nor does the list of people of the administrator.
	list := b.do("GET", "/api/users", nil)
	expect(t, list, http.StatusOK)
	if strings.Contains(list.Body.String(), "$argon2") || strings.Contains(strings.ToLower(list.Body.String()), "hash") {
		t.Errorf("/api/users = %s", list.Body)
	}
}
