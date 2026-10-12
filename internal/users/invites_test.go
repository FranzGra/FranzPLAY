package users

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestInviteStatus(t *testing.T) {
	expires := time.Date(2026, 10, 19, 10, 0, 0, 0, time.UTC)
	tests := []struct {
		name string
		used bool
		now  time.Time
		want InviteStatus
	}{
		{"waiting", false, expires.Add(-time.Second), InviteWaiting},
		{"expired at the second it ends", false, expires, InviteExpired},
		{"used stays used, even later", true, expires.Add(time.Hour), InviteUsed},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := inviteStatus(tt.used, expires, tt.now); got != tt.want {
				t.Errorf("inviteStatus = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestCleanNote(t *testing.T) {
	tests := []struct {
		note, want string
		err        error
	}{
		{"  Per la nonna ", "Per la nonna", nil},
		{"", "", nil},
		{strings.Repeat("è", maxNote), strings.Repeat("è", maxNote), nil},
		{strings.Repeat("è", maxNote+1), "", errBadNote},
		{"due\nrighe", "", errBadNote},
	}
	for _, tt := range tests {
		got, err := cleanNote(tt.note)
		if got != tt.want || !errors.Is(err, tt.err) {
			t.Errorf("cleanNote(%q) = %q, %v; want %q, %v", tt.note, got, err, tt.want, tt.err)
		}
	}
}

// invite makes an invite as admin and returns its code.
func invite(t *testing.T, admin *browser, note string, canUpload bool) newInvite {
	t.Helper()
	rec := admin.do("POST", "/api/invites", map[string]any{"note": note, "canUpload": canUpload})
	expect(t, rec, http.StatusCreated)
	var inv newInvite
	if err := json.Unmarshal(rec.Body.Bytes(), &inv); err != nil {
		t.Fatal(err)
	}
	if inv.Code == "" {
		t.Fatal("the new invite has no code")
	}
	return inv
}

func invites(t *testing.T, admin *browser) []Invite {
	t.Helper()
	rec := admin.do("GET", "/api/invites", nil)
	expect(t, rec, http.StatusOK)
	var list []Invite
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	return list
}

func TestJoinWithAnInvite(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	inv := invite(t, admin, " Nonna Maria ", true)
	if inv.Note != "Nonna Maria" || inv.Status != InviteWaiting || inv.CreatedBy != "Admin" ||
		!inv.ExpiresAt.Equal(s.now.Add(inviteLife)) {
		t.Fatalf("invite = %+v", inv)
	}

	guest := s.browser()
	expect(t, guest.do("POST", "/api/join/check", map[string]string{"code": inv.Code}), http.StatusNoContent)
	// Mistakes in the form do not use up the invite.
	expect(t, guest.do("POST", "/api/join", map[string]string{"code": inv.Code, "name": "M", "password": "maria-password"}),
		http.StatusBadRequest)
	expect(t, guest.do("POST", "/api/join", map[string]string{"code": inv.Code, "name": "admin", "password": "maria-password"}),
		http.StatusConflict)
	expect(t, guest.do("POST", "/api/join", map[string]string{"code": inv.Code, "name": "Maria", "password": "corta"}),
		http.StatusBadRequest)

	rec := guest.do("POST", "/api/join", map[string]string{"code": inv.Code, "name": " Maria ", "password": "maria-password"})
	expect(t, rec, http.StatusCreated)
	var maria Account
	if err := json.Unmarshal(rec.Body.Bytes(), &maria); err != nil {
		t.Fatal(err)
	}
	if maria.Name != "Maria" || maria.Role != User || !maria.CanUpload {
		t.Fatalf("account = %+v, want a normal user who can upload", maria)
	}
	expect(t, guest.do("GET", "/api/me", nil), http.StatusOK) // logged in at once
	expect(t, guest.do("GET", "/api/invites", nil), http.StatusForbidden)

	// A link makes one account only.
	other := s.browser()
	expect(t, other.do("POST", "/api/join/check", map[string]string{"code": inv.Code}), http.StatusGone)
	expect(t, other.do("POST", "/api/join", map[string]string{"code": inv.Code, "name": "Marco", "password": "marco-password"}),
		http.StatusGone)

	list := invites(t, admin)
	if len(list) != 1 || list[0].Status != InviteUsed || list[0].UsedBy != "Maria" {
		t.Fatalf("invites = %+v", list)
	}
	if strings.Contains(s.logs.String(), inv.Code) {
		t.Error("the invite code is in the log")
	}
}

func TestInviteCodeIsNotKept(t *testing.T) {
	s := newSite(t)
	inv := invite(t, s.setUp(), "", false)
	var hash []byte
	if err := s.db.QueryRow(`SELECT token_hash FROM invites`).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(hash, []byte(inv.Code)) || !bytes.Equal(hash, hashToken(inv.Code)) {
		t.Fatal("the database keeps the code instead of its hash")
	}
}

func TestInviteExpires(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	inv := invite(t, admin, "", false)
	s.now = s.now.Add(inviteLife)
	expect(t, s.browser().do("POST", "/api/join", map[string]string{"code": inv.Code, "name": "Marco", "password": "marco-password"}),
		http.StatusGone)
	if list := invites(t, admin); len(list) != 1 || list[0].Status != InviteExpired {
		t.Fatalf("invites = %+v", list)
	}
}

func TestDeletedInviteStopsWorking(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	inv := invite(t, admin, "", false)
	expect(t, admin.do("DELETE", "/api/invites/"+itoa(inv.ID), nil), http.StatusNoContent)
	expect(t, admin.do("DELETE", "/api/invites/"+itoa(inv.ID), nil), http.StatusNotFound)
	expect(t, admin.do("DELETE", "/api/invites/abc", nil), http.StatusNotFound)
	expect(t, s.browser().do("POST", "/api/join/check", map[string]string{"code": inv.Code}), http.StatusGone)
	if list := invites(t, admin); len(list) != 0 {
		t.Fatalf("invites = %+v", list)
	}
}

func TestOnlyAdministratorsInvite(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	expect(t, admin.do("POST", "/api/users", map[string]any{"name": "Giulia", "password": "giulia-password", "role": "user"}),
		http.StatusCreated)
	user := s.browser()
	expect(t, user.do("POST", "/api/login", map[string]string{"name": "Giulia", "password": "giulia-password"}), http.StatusOK)
	expect(t, user.do("GET", "/api/invites", nil), http.StatusForbidden)
	expect(t, user.do("POST", "/api/invites", map[string]any{"note": ""}), http.StatusForbidden)
	expect(t, s.browser().do("GET", "/api/invites", nil), http.StatusUnauthorized)

	expect(t, admin.do("POST", "/api/invites", map[string]any{"note": "due\nrighe"}), http.StatusBadRequest)
	expect(t, admin.do("POST", "/api/invites", map[string]any{"note": "", "isAdmin": true}), http.StatusBadRequest)
}

func TestMadeUpInviteCodes(t *testing.T) {
	s := newSite(t)
	s.setUp()
	b := s.browser()
	for _, code := range []string{"", "made-up", strings.Repeat("x", 200)} {
		expect(t, b.do("POST", "/api/join/check", map[string]string{"code": code}), http.StatusGone)
		expect(t, b.do("POST", "/api/join", map[string]string{"code": code, "name": "Marco", "password": "marco-password"}),
			http.StatusGone)
	}
}
