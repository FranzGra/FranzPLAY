package users

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
	"time"
)

func TestRecentRegistrations(t *testing.T) {
	now := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	times := []time.Time{
		now.Add(-registrationWindow - time.Second), // too old
		now.Add(-registrationWindow),               // exactly at the edge: too old
		now.Add(-time.Minute),
		now,
	}
	got := recentRegistrations(times, now)
	if len(got) != 2 || !got[0].Equal(now.Add(-time.Minute)) {
		t.Fatalf("recentRegistrations = %v", got)
	}
	if got := recentRegistrations(nil, now); len(got) != 0 {
		t.Fatalf("no registrations: %v", got)
	}
}

// setupStatusOf reads GET /api/setup.
func setupStatusOf(t *testing.T, b *browser) setupStatus {
	t.Helper()
	rec := b.do("GET", "/api/setup", nil)
	expect(t, rec, http.StatusOK)
	var st setupStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	return st
}

func TestRegistrationIsClosedUntilTheAdministratorOpensIt(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	stranger := s.browser()

	if setupStatusOf(t, stranger).OpenRegistration {
		t.Fatal("a new FranzPLAY must not let anyone register")
	}
	expect(t, stranger.do("POST", "/api/register", map[string]string{"name": "Giulia", "password": "giulia-password"}),
		http.StatusForbidden)
	expect(t, admin.do("GET", "/api/registration", nil), http.StatusOK)

	// Only the administrator opens it.
	expect(t, stranger.do("PUT", "/api/registration", map[string]bool{"open": true}), http.StatusUnauthorized)
	expect(t, admin.do("PUT", "/api/registration", map[string]bool{"open": true}), http.StatusOK)
	if !setupStatusOf(t, stranger).OpenRegistration {
		t.Fatal("the login page is not told that registering is allowed")
	}

	rec := stranger.do("POST", "/api/register", map[string]string{"name": "Giulia", "password": "giulia-password"})
	expect(t, rec, http.StatusCreated)
	a := whoAmI(t, stranger) // logged in at once
	if a.Name != "Giulia" || a.Role != User || a.CanUpload {
		t.Fatalf("registered account = %+v, want a normal user who cannot upload", a)
	}
	expect(t, s.browser().do("POST", "/api/register", map[string]string{"name": "giulia", "password": "another-password"}),
		http.StatusConflict)

	// Closed again: nobody else gets in, and the one who did stays.
	expect(t, admin.do("PUT", "/api/registration", map[string]bool{"open": false}), http.StatusOK)
	expect(t, s.browser().do("POST", "/api/register", map[string]string{"name": "Marco", "password": "marco-password"}),
		http.StatusForbidden)
	expect(t, stranger.do("GET", "/api/me", nil), http.StatusOK)
}

func TestNormalUsersCannotOpenRegistration(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	expect(t, admin.do("POST", "/api/users", map[string]any{
		"name": "Giulia", "password": "giulia-password", "role": "user",
	}), http.StatusCreated)
	b := s.browser()
	expect(t, b.do("POST", "/api/login", map[string]string{"name": "Giulia", "password": "giulia-password"}), http.StatusOK)
	expect(t, b.do("GET", "/api/registration", nil), http.StatusForbidden)
	expect(t, b.do("PUT", "/api/registration", map[string]bool{"open": true}), http.StatusForbidden)
}

func TestInvitesWorkWhileRegistrationIsClosed(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	inv := invite(t, admin, "Giulia", false)
	expect(t, s.browser().do("POST", "/api/join", map[string]string{
		"code": inv.Code, "name": "Giulia", "password": "giulia-password",
	}), http.StatusCreated)
}

func TestRegisterChecksTheForm(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	expect(t, admin.do("PUT", "/api/registration", map[string]bool{"open": true}), http.StatusOK)
	tests := []struct {
		name string
		body any
	}{
		{"name too short", map[string]string{"name": "Gi", "password": "giulia-password"}},
		{"password too short", map[string]string{"name": "Giulia", "password": "corta"}},
		{"unknown field", map[string]string{"name": "Giulia", "password": "giulia-password", "role": "admin"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			expect(t, s.browser().do("POST", "/api/register", tt.body), http.StatusBadRequest)
		})
	}
}

func TestTooManyAccountsFromTheSameAddress(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	expect(t, admin.do("PUT", "/api/registration", map[string]bool{"open": true}), http.StatusOK)
	register := func(i int) int {
		body := map[string]string{"name": "Persona " + strconv.Itoa(i), "password": "una-password"}
		return s.browser().do("POST", "/api/register", body).Code
	}
	for i := range maxRegistrations {
		if got := register(i); got != http.StatusCreated {
			t.Fatalf("account %d: status %d", i, got)
		}
	}
	rec := s.browser().do("POST", "/api/register", map[string]string{"name": "Troppi", "password": "una-password"})
	expect(t, rec, http.StatusTooManyRequests)
	if rec.Header().Get("Retry-After") == "" {
		t.Error("no Retry-After header")
	}
	// After the window, the address may make accounts again.
	s.now = s.now.Add(registrationWindow)
	if got := register(99); got != http.StatusCreated {
		t.Fatalf("after waiting: status %d", got)
	}
}
