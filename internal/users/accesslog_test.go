package users

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestLogName(t *testing.T) {
	if got := logName("Giulia"); got != "Giulia" {
		t.Errorf("logName = %q", got)
	}
	if got := logName(strings.Repeat("è", maxLogName+10)); got != strings.Repeat("è", maxLogName) {
		t.Errorf("long name kept as %q", got)
	}
	if got := logName("a\xffb"); got != "a�b" {
		t.Errorf("broken text kept as %q", got)
	}
}

func TestLikePatternFindsSymbolsAsTheyAre(t *testing.T) {
	if got := likePattern(`50%_a\b`); got != `%50\%\_a\\b%` {
		t.Errorf("likePattern = %q", got)
	}
}

// logins reads a page of the access log as the administrator.
func logins(t *testing.T, admin *browser, query string) loginPage {
	t.Helper()
	rec := admin.do("GET", "/api/logins"+query, nil)
	expect(t, rec, http.StatusOK)
	var page loginPage
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	return page
}

func TestEveryLoginGoesInTheAccessLog(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	expect(t, admin.do("POST", "/api/users", map[string]any{
		"name": "Giulia", "password": "giulia-password", "role": "user",
	}), http.StatusCreated)

	b := s.browser()
	expect(t, b.do("POST", "/api/login", map[string]string{"name": "Giulia", "password": "sbagliata!"}), http.StatusUnauthorized)
	expect(t, b.do("POST", "/api/login", map[string]string{"name": "Nessuno", "password": "sbagliata!"}), http.StatusUnauthorized)
	s.now = s.now.Add(time.Minute)
	expect(t, b.do("POST", "/api/login", map[string]string{"name": " Giulia ", "password": "giulia-password"}), http.StatusOK)

	page := logins(t, admin, "")
	if len(page.Logins) != 3 || page.More {
		t.Fatalf("access log = %+v", page)
	}
	newest := page.Logins[0]
	if newest.Name != "Giulia" || newest.Outcome != Entered || newest.Address != "192.0.2.1" ||
		!newest.At.Equal(s.now) {
		t.Errorf("newest entry = %+v", newest)
	}
	if page.Logins[1].Name != "Nessuno" || page.Logins[1].Outcome != WrongPassword {
		t.Errorf("a name that does not exist: %+v", page.Logins[1])
	}

	failed := logins(t, admin, "?failed=1")
	if len(failed.Logins) != 2 {
		t.Errorf("only failed: %+v", failed.Logins)
	}
	found := logins(t, admin, "?q=nessu")
	if len(found.Logins) != 1 || found.Logins[0].Name != "Nessuno" {
		t.Errorf("search by name: %+v", found.Logins)
	}
	if byAddress := logins(t, admin, "?q=192.0.2"); len(byAddress.Logins) != 3 {
		t.Errorf("search by address: %+v", byAddress.Logins)
	}

	// The list of people says when each one last entered.
	rec := admin.do("GET", "/api/users", nil)
	expect(t, rec, http.StatusOK)
	var people []Person
	if err := json.Unmarshal(rec.Body.Bytes(), &people); err != nil {
		t.Fatal(err)
	}
	for _, p := range people {
		switch p.Name {
		case "Giulia":
			if p.LastLogin == nil || !p.LastLogin.Equal(s.now) {
				t.Errorf("Giulia's last login = %v, want %v", p.LastLogin, s.now)
			}
		case "Admin": // entered with the setup, never with the login form
			if p.LastLogin != nil {
				t.Errorf("Admin's last login = %v", p.LastLogin)
			}
		}
	}
}

func TestLockedNamesGoInTheAccessLog(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	b := s.browser()
	for range maxFailures {
		b.do("POST", "/api/login", map[string]string{"name": "Admin", "password": "indovino!"})
	}
	expect(t, b.do("POST", "/api/login", map[string]string{"name": "Admin", "password": "admin-password"}),
		http.StatusTooManyRequests)
	if got := logins(t, admin, "").Logins[0]; got.Outcome != Locked {
		t.Errorf("newest entry = %+v, want locked", got)
	}
}

func TestOnlyAdministratorsReadTheAccessLog(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	expect(t, admin.do("POST", "/api/users", map[string]any{
		"name": "Giulia", "password": "giulia-password", "role": "user",
	}), http.StatusCreated)
	b := s.browser()
	expect(t, b.do("GET", "/api/logins", nil), http.StatusUnauthorized)
	expect(t, b.do("POST", "/api/login", map[string]string{"name": "Giulia", "password": "giulia-password"}), http.StatusOK)
	expect(t, b.do("GET", "/api/logins", nil), http.StatusForbidden)
}

func TestAccessLogPages(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	ctx := context.Background()
	for range logPage + 5 {
		if err := s.svc.store.recordLogin(ctx, s.now, "Qualcuno", 0, "192.0.2.9", WrongPassword); err != nil {
			t.Fatal(err)
		}
	}
	first := logins(t, admin, "")
	if len(first.Logins) != logPage || !first.More {
		t.Fatalf("first page: %d entries, more %v", len(first.Logins), first.More)
	}
	last := first.Logins[len(first.Logins)-1].ID
	second := logins(t, admin, "?before="+itoa(last))
	if len(second.Logins) != 5 || second.More {
		t.Fatalf("second page: %d entries, more %v", len(second.Logins), second.More)
	}
	expect(t, admin.do("GET", "/api/logins?before=abc", nil), http.StatusBadRequest)
	expect(t, admin.do("GET", "/api/logins?q="+strings.Repeat("a", maxLogSearch+1), nil), http.StatusBadRequest)
}

func TestAccessLogForgetsOldEntries(t *testing.T) {
	s := newSite(t)
	ctx := context.Background()
	if err := s.svc.store.recordLogin(ctx, s.now, "Vecchio", 0, "192.0.2.9", WrongPassword); err != nil {
		t.Fatal(err)
	}
	s.now = s.now.Add(logLife + time.Hour)
	if err := s.svc.store.recordLogin(ctx, s.now, "Nuovo", 0, "192.0.2.9", WrongPassword); err != nil {
		t.Fatal(err)
	}
	list, _, err := s.svc.store.listLogins(ctx, loginFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Name != "Nuovo" {
		t.Fatalf("after 90 days: %+v", list)
	}
}

func TestAccessLogStaysSmall(t *testing.T) {
	s := newSite(t)
	ctx := context.Background()
	for range maxLogRows + 3 {
		if err := s.svc.store.recordLogin(ctx, s.now, "Qualcuno", 0, "192.0.2.9", WrongPassword); err != nil {
			t.Fatal(err)
		}
	}
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM logins`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != maxLogRows {
		t.Errorf("rows = %d, want %d", n, maxLogRows)
	}
}
