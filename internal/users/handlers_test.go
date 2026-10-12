package users

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/server"
)

// site is the whole FranzPLAY handler, protected, with a clock the test moves.
type site struct {
	t       *testing.T
	svc     *Service
	db      *sql.DB
	handler http.Handler
	now     time.Time
	logs    *bytes.Buffer
	dataDir string
}

func newSite(t *testing.T) *site {
	t.Helper()
	dataDir := t.TempDir()
	db, err := database.Open(context.Background(), dataDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	s := &site{t: t, db: db, now: time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC), logs: &bytes.Buffer{}, dataDir: dataDir}
	logger := slog.New(slog.NewTextHandler(s.logs, nil))
	s.svc, err = NewService(context.Background(), db, s.dataDir, logger)
	if err != nil {
		t.Fatal(err)
	}
	s.svc.now = func() time.Time { return s.now }
	secret := func(mux *http.ServeMux) {
		mux.HandleFunc("GET /api/secret", func(w http.ResponseWriter, r *http.Request) {
			a, _ := FromContext(r.Context())
			_, _ = io.WriteString(w, "hello "+a.Name)
		})
	}
	ui := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "ui") })
	s.handler = s.svc.Protect(server.New("test", logger, ui, s.svc.Routes, secret))
	return s
}

// browser keeps cookies between requests, like a real one.
type browser struct {
	site   *site
	cookie string
}

func (s *site) browser() *browser { return &browser{site: s} }

func (b *browser) do(method, path string, body any, header ...string) *httptest.ResponseRecorder {
	b.site.t.Helper()
	var r io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			b.site.t.Fatal(err)
		}
		r = bytes.NewReader(data)
	}
	req := httptest.NewRequest(method, path, r)
	for i := 0; i+1 < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	if b.cookie != "" {
		req.AddCookie(&http.Cookie{Name: cookieName, Value: b.cookie})
	}
	rec := httptest.NewRecorder()
	b.site.handler.ServeHTTP(rec, req)
	for _, c := range rec.Result().Cookies() {
		if c.Name == cookieName {
			b.cookie = c.Value
			if c.MaxAge < 0 {
				b.cookie = ""
			}
		}
	}
	return rec
}

func expect(t *testing.T, rec *httptest.ResponseRecorder, status int) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, status, rec.Body)
	}
}

// setUp creates the administrator "Admin" and returns the browser logged in.
func (s *site) setUp() *browser {
	s.t.Helper()
	b := s.browser()
	expect(s.t, b.do("POST", "/api/setup", map[string]string{
		"code": s.svc.setupCode, "name": "Admin", "password": "admin-password",
	}), http.StatusCreated)
	return b
}

func TestSetupNeedsTheCodeFromTheLog(t *testing.T) {
	s := newSite(t)
	code := s.svc.setupCode
	if code == "" || !strings.Contains(s.logs.String(), code) {
		t.Fatalf("setup code %q not in the log", code)
	}

	b := s.browser()
	rec := b.do("GET", "/api/setup", nil)
	expect(t, rec, http.StatusOK)
	if strings.TrimSpace(rec.Body.String()) != `{"needed":true,"openRegistration":false}` {
		t.Fatalf("setup status %s", rec.Body)
	}
	expect(t, b.do("POST", "/api/setup", map[string]string{
		"code": "AAAA-AAAA-AAAA", "name": "Intruder", "password": "intruder-password",
	}), http.StatusUnauthorized)

	// The code is accepted typed in lower case and with spaces around.
	rec = b.do("POST", "/api/setup", map[string]string{
		"code": " " + strings.ToLower(code) + " ", "name": "Admin", "password": "admin-password",
	})
	expect(t, rec, http.StatusCreated)
	var a Account
	if err := json.Unmarshal(rec.Body.Bytes(), &a); err != nil {
		t.Fatal(err)
	}
	if a.Name != "Admin" || a.Role != Admin || !a.CanUpload {
		t.Fatalf("administrator = %+v", a)
	}
	expect(t, b.do("GET", "/api/me", nil), http.StatusOK) // logged in at once

	// Once set up, the code no longer works.
	expect(t, s.browser().do("POST", "/api/setup", map[string]string{
		"code": code, "name": "Second", "password": "second-password",
	}), http.StatusConflict)
	rec = b.do("GET", "/api/setup", nil)
	if strings.TrimSpace(rec.Body.String()) != `{"needed":false,"openRegistration":false}` {
		t.Fatalf("setup status %s", rec.Body)
	}
}

func TestNoSetupCodeWhenUsersExist(t *testing.T) {
	s := newSite(t)
	s.setUp()
	again, err := NewService(context.Background(), s.db, s.dataDir, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	if again.needsSetup() {
		t.Fatal("a restarted FranzPLAY asks for setup again")
	}
}

func TestAPINeedsLogin(t *testing.T) {
	s := newSite(t)
	b := s.browser()
	for _, path := range []string{"/api/secret", "/api/me", "/api/users", "/api/anything"} {
		expect(t, b.do("GET", path, nil), http.StatusUnauthorized)
	}
	expect(t, b.do("GET", "/api/health", nil), http.StatusOK)
	expect(t, b.do("GET", "/api/setup", nil), http.StatusOK)
	rec := b.do("GET", "/home", nil) // the interface itself shows the login page
	expect(t, rec, http.StatusOK)

	b.cookie = "made-up-token"
	expect(t, b.do("GET", "/api/secret", nil), http.StatusUnauthorized)
}

func TestLoginLogout(t *testing.T) {
	s := newSite(t)
	s.setUp()
	b := s.browser()
	expect(t, b.do("POST", "/api/login", map[string]string{"name": "admin", "password": "wrong-password"}),
		http.StatusUnauthorized)
	expect(t, b.do("POST", "/api/login", map[string]string{"name": "nobody", "password": "admin-password"}),
		http.StatusUnauthorized)

	rec := b.do("POST", "/api/login", map[string]string{"name": " admin ", "password": "admin-password"})
	expect(t, rec, http.StatusOK)
	c := rec.Result().Cookies()[0]
	if !c.HttpOnly || c.SameSite != http.SameSiteLaxMode || c.Secure || c.Path != "/" {
		t.Fatalf("cookie %+v", c)
	}
	rec = b.do("GET", "/api/secret", nil)
	expect(t, rec, http.StatusOK)
	if rec.Body.String() != "hello Admin" {
		t.Fatalf("secret = %q", rec.Body)
	}

	// The database keeps only a hash of the cookie.
	var stored []byte
	if err := s.db.QueryRow(`SELECT token_hash FROM sessions LIMIT 1`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(stored, []byte(b.cookie)) {
		t.Fatal("the cookie is stored in the database")
	}

	old := b.cookie
	expect(t, b.do("POST", "/api/logout", nil), http.StatusNoContent)
	if b.cookie != "" {
		t.Fatal("logout did not clear the cookie")
	}
	b.cookie = old // a copy of the old cookie no longer works
	expect(t, b.do("GET", "/api/secret", nil), http.StatusUnauthorized)
}

func TestSecureCookieBehindHTTPS(t *testing.T) {
	s := newSite(t)
	s.setUp()
	rec := s.browser().do("POST", "/api/login", map[string]string{"name": "Admin", "password": "admin-password"},
		"X-Forwarded-Proto", "https")
	expect(t, rec, http.StatusOK)
	if !rec.Result().Cookies()[0].Secure {
		t.Fatal("cookie not Secure behind HTTPS")
	}
}

func TestTooManyWrongPasswords(t *testing.T) {
	s := newSite(t)
	s.setUp()
	b := s.browser()
	for range maxFailures {
		expect(t, b.do("POST", "/api/login", map[string]string{"name": "Admin", "password": "wrong-password"}),
			http.StatusUnauthorized)
	}
	// Even the right password must wait.
	rec := b.do("POST", "/api/login", map[string]string{"name": "Admin", "password": "admin-password"})
	expect(t, rec, http.StatusTooManyRequests)
	if rec.Header().Get("Retry-After") != "60" {
		t.Fatalf("Retry-After = %q", rec.Header().Get("Retry-After"))
	}
	s.now = s.now.Add(lockout)
	expect(t, b.do("POST", "/api/login", map[string]string{"name": "Admin", "password": "admin-password"}),
		http.StatusOK)
}

func TestSessionExpiresWhenUnused(t *testing.T) {
	s := newSite(t)
	b := s.setUp()

	// Used every 20 days: it never expires.
	for range 3 {
		s.now = s.now.Add(20 * 24 * time.Hour)
		expect(t, b.do("GET", "/api/secret", nil), http.StatusOK)
	}
	// Unused for more than 30 days: login again.
	s.now = s.now.Add(sessionLife + time.Second)
	expect(t, b.do("GET", "/api/secret", nil), http.StatusUnauthorized)
}

func TestRequestsFromOtherSitesAreRefused(t *testing.T) {
	s := newSite(t)
	b := s.setUp()
	expect(t, b.do("POST", "/api/logout", nil, "Origin", "https://evil.example"), http.StatusForbidden)
	expect(t, b.do("POST", "/api/login", map[string]string{"name": "Admin", "password": "admin-password"},
		"Origin", "https://evil.example"), http.StatusForbidden)
	expect(t, b.do("GET", "/api/me", nil), http.StatusOK) // still logged in
	// From FranzPLAY's own page (httptest uses host example.com).
	expect(t, b.do("POST", "/api/logout", nil, "Origin", "http://example.com"), http.StatusNoContent)
}

func TestChangePassword(t *testing.T) {
	s := newSite(t)
	b := s.setUp()
	other := s.browser()
	expect(t, other.do("POST", "/api/login", map[string]string{"name": "Admin", "password": "admin-password"}),
		http.StatusOK)

	// A wrong current password is 403, not 401: the person is still logged in.
	expect(t, b.do("POST", "/api/me/password", map[string]string{"current": "wrong-password", "new": "new-password"}),
		http.StatusForbidden)
	expect(t, b.do("GET", "/api/me", nil), http.StatusOK)
	expect(t, b.do("POST", "/api/me/password", map[string]string{"current": "admin-password", "new": "short"}),
		http.StatusBadRequest)
	expect(t, b.do("POST", "/api/me/password", map[string]string{"current": "admin-password", "new": "new-password"}),
		http.StatusNoContent)

	expect(t, b.do("GET", "/api/me", nil), http.StatusOK)               // this browser stays in
	expect(t, other.do("GET", "/api/me", nil), http.StatusUnauthorized) // the others are logged out
	expect(t, s.browser().do("POST", "/api/login", map[string]string{"name": "Admin", "password": "new-password"}),
		http.StatusOK)
}

func TestChangePasswordCannotBeGuessed(t *testing.T) {
	s := newSite(t)
	b := s.setUp()
	wrong := map[string]string{"current": "wrong-password", "new": "new-password"}
	for range 20 {
		if rec := b.do("POST", "/api/me/password", wrong); rec.Code == http.StatusTooManyRequests {
			// Even the right password waits now.
			expect(t, b.do("POST", "/api/me/password",
				map[string]string{"current": "admin-password", "new": "new-password"}), http.StatusTooManyRequests)
			return
		}
	}
	t.Fatal("20 wrong current passwords and no pause")
}

func TestAdministratorManagesUsers(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()

	rec := admin.do("POST", "/api/users", map[string]any{
		"name": "Giulia", "password": "giulia-password", "role": "user", "canUpload": false,
	})
	expect(t, rec, http.StatusCreated)
	var giulia Account
	if err := json.Unmarshal(rec.Body.Bytes(), &giulia); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]map[string]any{
		"same name in other case": {"name": "giulia", "password": "another-password", "role": "user"},
		"bad role":                {"name": "Marco", "password": "marco-password", "role": "root"},
		"bad name":                {"name": "M", "password": "marco-password", "role": "user"},
		"unknown field":           {"name": "Marco", "password": "marco-password", "role": "user", "isAdmin": true},
	} {
		if rec := admin.do("POST", "/api/users", body); rec.Code == http.StatusCreated {
			t.Errorf("%s: user created", name)
		}
	}

	rec = admin.do("GET", "/api/users", nil)
	expect(t, rec, http.StatusOK)
	var list []Account
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].Name != "Admin" || list[1].Name != "Giulia" {
		t.Fatalf("users = %+v", list)
	}

	// A normal user cannot manage users.
	user := s.browser()
	expect(t, user.do("POST", "/api/login", map[string]string{"name": "Giulia", "password": "giulia-password"}),
		http.StatusOK)
	expect(t, user.do("GET", "/api/users", nil), http.StatusForbidden)
	expect(t, user.do("POST", "/api/users", map[string]any{"name": "Marco", "password": "marco-password", "role": "admin"}),
		http.StatusForbidden)

	// Deleting a user logs them out everywhere.
	expect(t, admin.do("DELETE", "/api/users/"+itoa(giulia.ID), nil), http.StatusNoContent)
	expect(t, user.do("GET", "/api/me", nil), http.StatusUnauthorized)
	expect(t, admin.do("DELETE", "/api/users/"+itoa(giulia.ID), nil), http.StatusNotFound)
	expect(t, admin.do("DELETE", "/api/users/abc", nil), http.StatusNotFound)
}

func TestLastAdministratorCannotBeDeleted(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	rec := admin.do("GET", "/api/me", nil)
	var me Account
	if err := json.Unmarshal(rec.Body.Bytes(), &me); err != nil {
		t.Fatal(err)
	}
	expect(t, admin.do("DELETE", "/api/users/"+itoa(me.ID), nil), http.StatusConflict)

	expect(t, admin.do("POST", "/api/users", map[string]any{"name": "Second", "password": "second-password", "role": "admin"}),
		http.StatusCreated)
	expect(t, admin.do("DELETE", "/api/users/"+itoa(me.ID), nil), http.StatusNoContent)
}

func TestBadRequestBodies(t *testing.T) {
	s := newSite(t)
	s.setUp()
	for name, body := range map[string]string{
		"not json":      "name=Admin",
		"unknown field": `{"name":"Admin","password":"admin-password","remember":true}`,
		"too big":       `{"name":"` + strings.Repeat("a", maxBody) + `"}`,
	} {
		req := httptest.NewRequest("POST", "/api/login", strings.NewReader(body))
		rec := httptest.NewRecorder()
		s.handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d", name, rec.Code)
		}
	}
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

func TestAdministratorChangesWhatUsersMayDo(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	me := whoAmI(t, admin)
	rec := admin.do("POST", "/api/users", map[string]any{"name": "Giulia", "password": "giulia-password", "role": "user"})
	expect(t, rec, http.StatusCreated)
	var giulia Account
	if err := json.Unmarshal(rec.Body.Bytes(), &giulia); err != nil {
		t.Fatal(err)
	}
	user := s.browser()
	expect(t, user.do("POST", "/api/login", map[string]string{"name": "Giulia", "password": "giulia-password"}),
		http.StatusOK)

	rec = admin.do("PUT", "/api/users/"+itoa(giulia.ID), map[string]any{"role": "user", "canUpload": true})
	expect(t, rec, http.StatusOK)
	if got := whoAmI(t, user); !got.CanUpload || got.Role != User {
		t.Errorf("after the change Giulia is %+v, want a user who can upload", got)
	}

	// The change counts at once, without logging in again.
	expect(t, admin.do("PUT", "/api/users/"+itoa(giulia.ID), map[string]any{"role": "admin", "canUpload": true}),
		http.StatusOK)
	expect(t, user.do("GET", "/api/users", nil), http.StatusOK)

	expect(t, user.do("PUT", "/api/users/"+itoa(me.ID), map[string]any{"role": "user"}), http.StatusOK)
	// Now Giulia is the only administrator: she cannot stop being one.
	expect(t, user.do("PUT", "/api/users/"+itoa(giulia.ID), map[string]any{"role": "user"}), http.StatusConflict)
	expect(t, admin.do("PUT", "/api/users/"+itoa(giulia.ID), map[string]any{"role": "user"}), http.StatusForbidden)

	for name, tc := range map[string]struct {
		path string
		body any
		want int
	}{
		"bad role":      {"/api/users/" + itoa(giulia.ID), map[string]any{"role": "root"}, http.StatusBadRequest},
		"unknown field": {"/api/users/" + itoa(giulia.ID), map[string]any{"role": "admin", "name": "X"}, http.StatusBadRequest},
		"no such user":  {"/api/users/999", map[string]any{"role": "user"}, http.StatusNotFound},
		"bad id":        {"/api/users/abc", map[string]any{"role": "user"}, http.StatusNotFound},
	} {
		if rec := user.do("PUT", tc.path, tc.body); rec.Code != tc.want {
			t.Errorf("%s: status %d, want %d", name, rec.Code, tc.want)
		}
	}
}

func TestAdministratorChoosesTheUploadQuota(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	rec := admin.do("POST", "/api/users", map[string]any{"name": "Giulia", "password": "giulia-password", "role": "user"})
	expect(t, rec, http.StatusCreated)
	var giulia Account
	if err := json.Unmarshal(rec.Body.Bytes(), &giulia); err != nil {
		t.Fatal(err)
	}
	if giulia.UploadQuota != DefaultUploadQuota {
		t.Errorf("a new person has a quota of %d bytes, want %d", giulia.UploadQuota, DefaultUploadQuota)
	}
	user := s.browser()
	expect(t, user.do("POST", "/api/login", map[string]string{"name": "Giulia", "password": "giulia-password"}),
		http.StatusOK)
	path := "/api/users/" + itoa(giulia.ID)

	const fifty = int64(50 << 30)
	expect(t, admin.do("PUT", path, map[string]any{"role": "user", "canUpload": true, "uploadQuota": fifty}),
		http.StatusOK)
	if got := whoAmI(t, user); got.UploadQuota != fifty {
		t.Errorf("after the change Giulia may upload %d bytes, want %d", got.UploadQuota, fifty)
	}
	// Leaving the quota out keeps it.
	expect(t, admin.do("PUT", path, map[string]any{"role": "user", "canUpload": false}), http.StatusOK)
	if got := whoAmI(t, user); got.UploadQuota != fifty || got.CanUpload {
		t.Errorf("after turning upload off Giulia is %+v, want the same quota and no upload", got)
	}

	for name, quota := range map[string]int64{
		"zero":      0,
		"negative":  -1,
		"too small": MinUploadQuota - 1,
		"too big":   MaxUploadQuota + 1,
	} {
		rec := admin.do("PUT", path, map[string]any{"role": "user", "canUpload": true, "uploadQuota": quota})
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s quota: status %d, want %d", name, rec.Code, http.StatusBadRequest)
		}
	}
	if got := whoAmI(t, user); got.UploadQuota != fifty {
		t.Errorf("refused changes moved the quota to %d", got.UploadQuota)
	}
}

func TestAdministratorResetsAPassword(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	me := whoAmI(t, admin)
	rec := admin.do("POST", "/api/users", map[string]any{"name": "Giulia", "password": "giulia-password", "role": "user"})
	expect(t, rec, http.StatusCreated)
	var giulia Account
	if err := json.Unmarshal(rec.Body.Bytes(), &giulia); err != nil {
		t.Fatal(err)
	}
	user := s.browser()
	expect(t, user.do("POST", "/api/login", map[string]string{"name": "Giulia", "password": "giulia-password"}),
		http.StatusOK)

	path := "/api/users/" + itoa(giulia.ID) + "/password"
	expect(t, admin.do("PUT", path, map[string]string{"password": "short"}), http.StatusBadRequest)
	expect(t, user.do("PUT", path, map[string]string{"password": "mine-now-password"}), http.StatusForbidden)
	expect(t, admin.do("PUT", "/api/users/999/password", map[string]string{"password": "nobody-password"}),
		http.StatusNotFound)
	expect(t, admin.do("PUT", path, map[string]string{"password": "fresh-password"}), http.StatusNoContent)

	// Giulia's open sessions end; the new password works, the old one not.
	expect(t, user.do("GET", "/api/me", nil), http.StatusUnauthorized)
	expect(t, s.browser().do("POST", "/api/login", map[string]string{"name": "Giulia", "password": "giulia-password"}),
		http.StatusUnauthorized)
	expect(t, s.browser().do("POST", "/api/login", map[string]string{"name": "Giulia", "password": "fresh-password"}),
		http.StatusOK)

	// An administrator resetting their own password stays logged in here.
	expect(t, admin.do("PUT", "/api/users/"+itoa(me.ID)+"/password", map[string]string{"password": "admin-new-password"}),
		http.StatusNoContent)
	expect(t, admin.do("GET", "/api/me", nil), http.StatusOK)
}

// whoAmI returns the user logged in on b.
func whoAmI(t *testing.T, b *browser) Account {
	t.Helper()
	rec := b.do("GET", "/api/me", nil)
	expect(t, rec, http.StatusOK)
	var a Account
	if err := json.Unmarshal(rec.Body.Bytes(), &a); err != nil {
		t.Fatal(err)
	}
	return a
}

func TestRenameMyself(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	expect(t, admin.do("POST", "/api/users", map[string]any{
		"name": "Giulia", "password": "giulia-password", "role": "user",
	}), http.StatusCreated)
	b := s.browser()
	expect(t, b.do("POST", "/api/login", map[string]string{"name": "Giulia", "password": "giulia-password"}),
		http.StatusOK)

	tests := []struct {
		name   string
		body   any
		status int
	}{
		{"too short", map[string]string{"name": "Gi"}, http.StatusBadRequest},
		{"strange symbols", map[string]string{"name": "Giulia<3"}, http.StatusBadRequest},
		{"another user's name", map[string]string{"name": "admin"}, http.StatusConflict},
		{"unknown field", map[string]string{"nome": "Giulietta"}, http.StatusBadRequest},
		{"only the capitals change", map[string]string{"name": "GIULIA"}, http.StatusOK},
		{"a new name, spaces around removed", map[string]string{"name": "  Giulia Rossi "}, http.StatusOK},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			expect(t, b.do("PUT", "/api/me/name", tt.body), tt.status)
		})
	}

	rec := b.do("GET", "/api/me", nil)
	expect(t, rec, http.StatusOK)
	var a Account
	if err := json.Unmarshal(rec.Body.Bytes(), &a); err != nil {
		t.Fatal(err)
	}
	if a.Name != "Giulia Rossi" || a.Role != User {
		t.Fatalf("after renaming: %+v", a)
	}
	// The new name is the one to log in with; the old one no longer works.
	expect(t, s.browser().do("POST", "/api/login", map[string]string{"name": "Giulia Rossi", "password": "giulia-password"}),
		http.StatusOK)
	expect(t, s.browser().do("POST", "/api/login", map[string]string{"name": "Giulia", "password": "giulia-password"}),
		http.StatusUnauthorized)
	expect(t, s.browser().do("PUT", "/api/me/name", map[string]string{"name": "Nobody"}), http.StatusUnauthorized)
}

func TestDeleteMyAccount(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	expect(t, admin.do("POST", "/api/users", map[string]any{
		"name": "Giulia", "password": "giulia-password", "role": "user",
	}), http.StatusCreated)
	b := s.browser()
	expect(t, b.do("POST", "/api/login", map[string]string{"name": "Giulia", "password": "giulia-password"}),
		http.StatusOK)
	phone := s.browser()
	expect(t, phone.do("POST", "/api/login", map[string]string{"name": "Giulia", "password": "giulia-password"}),
		http.StatusOK)

	// Without the right password nothing happens, and she stays logged in.
	expect(t, b.do("DELETE", "/api/me", map[string]string{"password": "wrong-password"}), http.StatusForbidden)
	expect(t, b.do("DELETE", "/api/me", nil), http.StatusBadRequest)
	expect(t, b.do("GET", "/api/me", nil), http.StatusOK)

	expect(t, b.do("DELETE", "/api/me", map[string]string{"password": "giulia-password"}), http.StatusNoContent)
	if b.cookie != "" {
		t.Fatal("the cookie of the deleted account is still there")
	}
	expect(t, phone.do("GET", "/api/me", nil), http.StatusUnauthorized) // every device is out
	expect(t, s.browser().do("POST", "/api/login", map[string]string{"name": "Giulia", "password": "giulia-password"}),
		http.StatusUnauthorized)
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM users WHERE name = 'Giulia'`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("Giulia still in the database: %d, %v", n, err)
	}
	expect(t, s.browser().do("DELETE", "/api/me", map[string]string{"password": "x"}), http.StatusUnauthorized)
}

func TestLastAdministratorCannotDeleteThemselves(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	expect(t, admin.do("DELETE", "/api/me", map[string]string{"password": "admin-password"}), http.StatusConflict)
	expect(t, admin.do("GET", "/api/me", nil), http.StatusOK)
}

func TestDeleteMyAccountCannotBeGuessed(t *testing.T) {
	s := newSite(t)
	b := s.setUp()
	for range 20 {
		if rec := b.do("DELETE", "/api/me", map[string]string{"password": "wrong-password"}); rec.Code == http.StatusTooManyRequests {
			return
		}
	}
	t.Fatal("20 wrong passwords and no pause")
}

func TestMyAccentColor(t *testing.T) {
	s := newSite(t)
	b := s.setUp()
	me := func() Account {
		t.Helper()
		rec := b.do("GET", "/api/me", nil)
		expect(t, rec, http.StatusOK)
		var a Account
		if err := json.Unmarshal(rec.Body.Bytes(), &a); err != nil {
			t.Fatal(err)
		}
		return a
	}
	if c := me().AccentColor; c != "" {
		t.Fatalf("a new user has color %q, want FranzPLAY's own", c)
	}

	rec := b.do("PUT", "/api/me/color", map[string]string{"color": "#DC2626"})
	expect(t, rec, http.StatusOK)
	if !strings.Contains(rec.Body.String(), `"accentColor":"#dc2626"`) {
		t.Fatalf("answer %s", rec.Body)
	}
	if c := me().AccentColor; c != "#dc2626" {
		t.Fatalf("color %q after choosing red", c)
	}
	// It comes with the login too, so the interface starts in the right color.
	rec = s.browser().do("POST", "/api/login", map[string]string{"name": "Admin", "password": "admin-password"})
	if !strings.Contains(rec.Body.String(), `"accentColor":"#dc2626"`) {
		t.Fatalf("login answer %s", rec.Body)
	}

	expect(t, b.do("PUT", "/api/me/color", map[string]string{"color": "url(evil)"}), http.StatusBadRequest)
	if c := me().AccentColor; c != "#dc2626" {
		t.Fatalf("a refused color changed it to %q", c)
	}
	expect(t, b.do("PUT", "/api/me/color", map[string]string{"color": ""}), http.StatusOK)
	if c := me().AccentColor; c != "" {
		t.Fatalf("color %q after going back to FranzPLAY's own", c)
	}
}
