package users

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/server"
)

func TestNewSecretRules(t *testing.T) {
	tests := []struct {
		m      Method
		secret string
		ok     bool
	}{
		{Password, "abcdefgh", true},
		{Password, "short", false},
		{PIN, "123456", true},
		{PIN, "12345", false},
		{PIN, "1234567", false},
		{PIN, "12345a", false},
		{PIN, "١٢٣٤٥٦", false}, // other digits than 0-9
		{Pattern, "12369", true},
		{Pattern, "123456789", true},
		{Pattern, "1236", false},  // 4 dots: too few
		{Pattern, "12321", false}, // a dot twice
		{Pattern, "12360", false}, // no dot 0
		{Method("face"), "x", false},
	}
	for _, tt := range tests {
		if err := checkNewSecret(tt.m, tt.secret); (err == nil) != tt.ok {
			t.Errorf("checkNewSecret(%s, %q) = %v, want ok %v", tt.m, tt.secret, err, tt.ok)
		}
	}
}

func TestBlocksGrowLonger(t *testing.T) {
	now := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	var b blockState
	var waits []time.Duration
	for range 5 {
		for range passwordPolicy.threshold {
			b = b.failed(passwordPolicy, now)
		}
		waits = append(waits, b.wait(now))
		now = b.until
	}
	want := []time.Duration{time.Minute, 5 * time.Minute, 15 * time.Minute, time.Hour, 4 * time.Hour}
	if !slices.Equal(waits, want) {
		t.Fatalf("waits = %v, want %v", waits, want)
	}
	// A day of quiet: everything starts again from the first, short block.
	now = now.Add(forgetAfter + time.Second)
	for range passwordPolicy.threshold {
		b = b.failed(passwordPolicy, now)
	}
	if got := b.wait(now); got != time.Minute {
		t.Fatalf("after a quiet day the block lasts %v, want a minute", got)
	}
}

func TestPINAndPatternAreStricter(t *testing.T) {
	now := time.Now()
	var b blockState
	for range secretPolicy.threshold {
		b = b.failed(policyFor(PIN), now)
	}
	if got := b.wait(now); got != 5*time.Minute {
		t.Fatalf("PIN block after %d tries = %v, want 5 minutes", secretPolicy.threshold, got)
	}
	if secretPolicy.threshold >= passwordPolicy.threshold || policyFor(Pattern).threshold != secretPolicy.threshold {
		t.Fatal("PIN and pattern must get fewer tries than a password")
	}
}

func TestRealAddress(t *testing.T) {
	proxy := []netip.Prefix{netip.MustParsePrefix("10.0.0.1/32"), netip.MustParsePrefix("172.18.0.0/16")}
	tests := []struct {
		remote, forwarded string
		want              string
	}{
		{"203.0.113.5:4000", "", "203.0.113.5"},
		// Not a trusted proxy: what it writes is not believed.
		{"203.0.113.5:4000", "198.51.100.7", "203.0.113.5"},
		{"10.0.0.1:4000", "198.51.100.7", "198.51.100.7"},
		// The person wrote a fake address first; the proxy added the real one.
		{"10.0.0.1:4000", "1.2.3.4, 198.51.100.7", "198.51.100.7"},
		// Two proxies in a row.
		{"10.0.0.1:4000", "198.51.100.7, 172.18.0.3", "198.51.100.7"},
		{"10.0.0.1:4000", "", "10.0.0.1"},
		{"10.0.0.1:4000", "garbage", "10.0.0.1"},
	}
	for _, tt := range tests {
		r := httptest.NewRequest("POST", "/api/login", nil)
		r.RemoteAddr = tt.remote
		if tt.forwarded != "" {
			r.Header.Set("X-Forwarded-For", tt.forwarded)
		}
		if got := realAddr(r, proxy); got != tt.want {
			t.Errorf("realAddr(%s, %q) = %s, want %s", tt.remote, tt.forwarded, got, tt.want)
		}
	}
}

// methodOfName asks the login page's question.
func methodOfName(t *testing.T, b *browser, name string) Method {
	t.Helper()
	rec := b.do("POST", "/api/login/method", map[string]string{"name": name})
	expect(t, rec, http.StatusOK)
	var got methodAnswer
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	return got.Method
}

func login(b *browser, name, secret string) *httptest.ResponseRecorder {
	return b.do("POST", "/api/login", map[string]string{"name": name, "password": secret})
}

func TestPINAndPatternLogin(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	expect(t, admin.do("POST", "/api/users", map[string]any{
		"name": "Nonna", "method": "pin", "password": "482915", "role": "user",
	}), http.StatusCreated)
	expect(t, admin.do("POST", "/api/users", map[string]any{
		"name": "Luca", "method": "pattern", "password": "15963", "role": "user",
	}), http.StatusCreated)

	// Only a hash is kept, never the PIN itself.
	var stored string
	if err := s.db.QueryRow(`SELECT password_hash FROM users WHERE name = 'Nonna'`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored, "482915") || !strings.HasPrefix(stored, "argon2id$") {
		t.Fatalf("stored = %q, want an Argon2id hash", stored)
	}

	b := s.browser()
	if m := methodOfName(t, b, "nonna"); m != PIN {
		t.Fatalf("method of Nonna = %s", m)
	}
	if m := methodOfName(t, b, "Luca"); m != Pattern {
		t.Fatalf("method of Luca = %s", m)
	}
	expect(t, login(b, "Nonna", "482915"), http.StatusOK)
	expect(t, login(s.browser(), "Luca", "15963"), http.StatusOK)
	expect(t, login(s.browser(), "Luca", "36951"), http.StatusUnauthorized) // same dots, other order
}

func TestUnknownNamesGetAStableDecoy(t *testing.T) {
	s := newSite(t)
	s.setUp()
	b := s.browser()
	seen := map[Method]bool{}
	for _, name := range []string{"Mario", "Paola", "Zeno", "Ugo", "Ada", "Bruno", "Carla", "Dino"} {
		m := methodOfName(t, b, name)
		if again := methodOfName(t, b, strings.ToUpper(name)); again != m {
			t.Fatalf("%s: %s then %s", name, m, again)
		}
		seen[m] = true
	}
	if len(seen) < 2 {
		t.Fatalf("every unknown name gets %v: a fixed answer would tell them apart from real ones", seen)
	}
	// Same answer after a restart.
	before := methodOfName(t, b, "Mario")
	svc, err := NewService(context.Background(), s.db, s.dataDir, false, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	if got := decoyMethod(svc.methodKey, "Mario", Methods(allMethods)); got != before {
		t.Fatalf("decoy after restart = %s, was %s", got, before)
	}
}

func TestBlocksSurviveARestart(t *testing.T) {
	s := newSite(t)
	s.setUp()
	for range passwordPolicy.threshold {
		login(s.browser(), "Admin", "wrong-password")
	}
	svc, err := NewService(context.Background(), s.db, s.dataDir, false, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	svc.now = func() time.Time { return s.now }
	s.svc = svc
	s.handler = svc.Protect(server.New("test", slog.New(slog.NewTextHandler(io.Discard, nil)), http.NotFoundHandler(), svc.Routes))
	rec := login(s.browser(), "Admin", "admin-password")
	expect(t, rec, http.StatusTooManyRequests)
	if !strings.Contains(rec.Body.String(), "1m0s") {
		t.Fatalf("the answer should say how long to wait: %s", rec.Body)
	}
}

func TestOneAddressTryingManyNamesIsBlocked(t *testing.T) {
	s := newSite(t)
	s.setUp()
	b := s.browser()
	from := "203.0.113.9:5000"
	for i := range addressPolicy.threshold {
		b.do("POST", "/api/login", map[string]string{"name": "nome" + string(rune('a'+i)), "password": "123456"},
			"RemoteAddr", from)
	}
	// The address is blocked even for a right password…
	expect(t, b.do("POST", "/api/login", map[string]string{"name": "Admin", "password": "admin-password"},
		"RemoteAddr", from), http.StatusTooManyRequests)
	// …but not someone else.
	expect(t, b.do("POST", "/api/login", map[string]string{"name": "Admin", "password": "admin-password"},
		"RemoteAddr", "198.51.100.1:5000"), http.StatusOK)
}

func TestPINIsBlockedSooner(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	expect(t, admin.do("POST", "/api/users", map[string]any{
		"name": "Nonna", "method": "pin", "password": "482915", "role": "user",
	}), http.StatusCreated)
	b := s.browser()
	for range secretPolicy.threshold - 1 {
		expect(t, login(b, "Nonna", "000000"), http.StatusUnauthorized)
	}
	rec := login(b, "Nonna", "111111")
	expect(t, rec, http.StatusTooManyRequests)
	if rec.Header().Get("Retry-After") != "300" {
		t.Fatalf("Retry-After = %q, want 5 minutes", rec.Header().Get("Retry-After"))
	}

	// The administrator sees the block and can lift it.
	rec = admin.do("GET", "/api/logins/blocks", nil)
	expect(t, rec, http.StatusOK)
	var blocks []Block
	if err := json.NewDecoder(rec.Body).Decode(&blocks); err != nil {
		t.Fatal(err)
	}
	if len(blocks) != 1 || blocks[0].Kind != "account" || blocks[0].Value != "nonna" {
		t.Fatalf("blocks = %+v", blocks)
	}
	expect(t, admin.do("POST", "/api/logins/unblock", map[string]string{"key": blocks[0].Key}), http.StatusNoContent)
	expect(t, login(b, "Nonna", "482915"), http.StatusOK)
}

func TestServerMethods(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	expect(t, admin.do("PUT", "/api/registration", map[string]bool{"open": true}), http.StatusOK)
	expect(t, admin.do("PUT", "/api/login-methods", map[string]any{"methods": []string{}}), http.StatusBadRequest)
	expect(t, admin.do("PUT", "/api/login-methods", map[string]any{"methods": []string{"password", "pattern"}}), http.StatusOK)

	b := s.browser()
	expect(t, b.do("POST", "/api/register", map[string]string{"name": "Mario", "method": "pin", "password": "123456"}),
		http.StatusBadRequest)
	expect(t, b.do("POST", "/api/register", map[string]string{"name": "Mario", "method": "pattern", "password": "74123"}),
		http.StatusCreated)
	// Decoys come only from allowed methods.
	for _, name := range []string{"a1", "b2", "c3", "d4", "e5", "f6"} {
		if m := methodOfName(t, s.browser(), name); m == PIN {
			t.Fatalf("decoy for %s is a PIN, which the server does not allow", name)
		}
	}
	// Only administrators choose.
	expect(t, b.do("PUT", "/api/login-methods", map[string]any{"methods": []string{"pin"}}), http.StatusForbidden)
}

func TestOwnMethodsNarrowTheServer(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	// Only a password for Giulia, though the server allows all three.
	rec := admin.do("POST", "/api/users", map[string]any{
		"name": "Giulia", "method": "pin", "password": "123456", "role": "user", "ownMethods": []string{"password"},
	})
	expect(t, rec, http.StatusBadRequest)
	rec = admin.do("POST", "/api/users", map[string]any{
		"name": "Giulia", "password": "giulia-password", "role": "user", "ownMethods": []string{"password"},
	})
	expect(t, rec, http.StatusCreated)
	var giulia Account
	if err := json.NewDecoder(rec.Body).Decode(&giulia); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(giulia.AllowedMethods, Methods{Password}) {
		t.Fatalf("allowed = %v", giulia.AllowedMethods)
	}
	g := s.browser()
	expect(t, login(g, "Giulia", "giulia-password"), http.StatusOK)
	expect(t, g.do("PUT", "/api/me/credential", map[string]string{
		"current": "giulia-password", "method": "pin", "secret": "123456",
	}), http.StatusBadRequest)
	// The administrator cannot give her a PIN either.
	path := "/api/users/" + strconv.FormatInt(giulia.ID, 10)
	expect(t, admin.do("PUT", path+"/password", map[string]string{"method": "pin", "password": "123456"}), http.StatusBadRequest)
	// Back to the server's choice: now she may.
	expect(t, admin.do("PUT", path, map[string]any{"role": "user", "canUpload": false, "ownMethods": []string{}}), http.StatusOK)
	expect(t, g.do("PUT", "/api/me/credential", map[string]string{
		"current": "giulia-password", "method": "pin", "secret": "123456",
	}), http.StatusNoContent)
	expect(t, login(s.browser(), "Giulia", "123456"), http.StatusOK)
	// A narrowing outside the server's methods is refused.
	expect(t, admin.do("PUT", "/api/login-methods", map[string]any{"methods": []string{"password", "pin"}}), http.StatusOK)
	expect(t, admin.do("PUT", path, map[string]any{"role": "user", "canUpload": false, "ownMethods": []string{"pattern"}}),
		http.StatusBadRequest)
}

func TestChangingMethodNeedsTheCurrentOne(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	expect(t, admin.do("PUT", "/api/me/credential", map[string]string{
		"current": "wrong-password", "method": "pattern", "secret": "14789",
	}), http.StatusForbidden)
	expect(t, admin.do("POST", "/api/me/check", map[string]string{"current": "wrong-password"}), http.StatusForbidden)
	expect(t, admin.do("POST", "/api/me/check", map[string]string{"current": "admin-password"}), http.StatusNoContent)
	expect(t, admin.do("PUT", "/api/me/credential", map[string]string{
		"current": "admin-password", "method": "pattern", "secret": "1478",
	}), http.StatusBadRequest)
	expect(t, admin.do("PUT", "/api/me/credential", map[string]string{
		"current": "admin-password", "method": "pattern", "secret": "14789",
	}), http.StatusNoContent)
	expect(t, admin.do("GET", "/api/me", nil), http.StatusOK) // this browser stays in
	expect(t, login(s.browser(), "Admin", "admin-password"), http.StatusUnauthorized)
	expect(t, login(s.browser(), "Admin", "14789"), http.StatusOK)
	// Now the pattern is what confirms the next change.
	expect(t, admin.do("PUT", "/api/me/credential", map[string]string{
		"current": "14789", "method": "password", "secret": "a-new-password",
	}), http.StatusNoContent)
}

func TestRemovedMethodMustBeReplaced(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	expect(t, admin.do("POST", "/api/users", map[string]any{
		"name": "Nonna", "method": "pin", "password": "482915", "role": "user",
	}), http.StatusCreated)
	expect(t, admin.do("PUT", "/api/login-methods", map[string]any{"methods": []string{"password"}}), http.StatusOK)

	// Her PIN still opens the door: nobody is locked out…
	n := s.browser()
	if m := methodOfName(t, n, "Nonna"); m != PIN {
		t.Fatalf("method = %s: the login page must still show her PIN pad", m)
	}
	rec := login(n, "Nonna", "482915")
	expect(t, rec, http.StatusOK)
	var me Account
	if err := json.NewDecoder(rec.Body).Decode(&me); err != nil {
		t.Fatal(err)
	}
	if !me.MustChooseMethod {
		t.Fatal("mustChooseMethod is false")
	}
	// …but before anything else she must choose an allowed method.
	expect(t, n.do("GET", "/api/secret", nil), http.StatusForbidden)
	expect(t, n.do("GET", "/api/me", nil), http.StatusOK)
	expect(t, n.do("PUT", "/api/me/credential", map[string]string{
		"current": "482915", "method": "pin", "secret": "111222",
	}), http.StatusBadRequest)
	expect(t, n.do("PUT", "/api/me/credential", map[string]string{
		"current": "482915", "method": "password", "secret": "nonna-password",
	}), http.StatusNoContent)
	expect(t, n.do("GET", "/api/secret", nil), http.StatusOK)
}

func TestDeleteAccountWithPattern(t *testing.T) {
	s := newSite(t)
	admin := s.setUp()
	expect(t, admin.do("POST", "/api/users", map[string]any{
		"name": "Luca", "method": "pattern", "password": "15963", "role": "user",
	}), http.StatusCreated)
	b := s.browser()
	expect(t, login(b, "Luca", "15963"), http.StatusOK)
	expect(t, b.do("DELETE", "/api/me", map[string]string{"password": "36951"}), http.StatusForbidden)
	expect(t, b.do("DELETE", "/api/me", map[string]string{"password": "15963"}), http.StatusNoContent)
}
