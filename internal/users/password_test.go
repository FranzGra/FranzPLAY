package users

import (
	"errors"
	"os"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

// TestMain makes password hashes light, so the many logins in these tests
// take milliseconds instead of seconds (much more under the race detector).
func TestMain(m *testing.M) {
	hashCost = argonCost{time: 1, memory: 64, threads: 1}
	os.Exit(m.Run())
}

func TestRealHashCostIsTheOWASPMinimum(t *testing.T) {
	// Argon2id, OWASP Password Storage Cheat Sheet: m=19 MiB, t=2, p=1.
	if want := (argonCost{time: 2, memory: 19 * 1024, threads: 1}); productionCost != want {
		t.Fatalf("production cost = %+v, want %+v", productionCost, want)
	}
}

func TestHashAndVerify(t *testing.T) {
	hash, err := hashPassword("correct horse")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(hash, "correct horse") || !strings.HasPrefix(hash, "argon2id$v=19$m=64,t=1,p=1$") {
		t.Fatalf("unexpected hash %q", hash)
	}
	for _, tc := range []struct {
		password string
		want     bool
	}{
		{"correct horse", true},
		{"Correct horse", false},
		{"correct horse ", false},
		{"", false},
	} {
		got, err := verifyPassword(tc.password, hash)
		if err != nil || got != tc.want {
			t.Errorf("verifyPassword(%q) = %v, %v; want %v", tc.password, got, err, tc.want)
		}
	}

	// The same password gives a different hash each time (random salt), so
	// two users with the same password cannot be spotted in the database.
	again, err := hashPassword("correct horse")
	if err != nil {
		t.Fatal(err)
	}
	if again == hash {
		t.Error("two hashes of the same password are equal")
	}
}

func TestParseHashRefusesDamagedOrHeavyHashes(t *testing.T) {
	good, err := hashPassword("password")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(good, "$")
	salt, key := parts[3], parts[4]
	for name, stored := range map[string]string{
		"empty":          "",
		"other method":   "bcrypt$v=19$m=19456,t=2,p=1$" + salt + "$" + key,
		"other version":  "argon2id$v=16$m=19456,t=2,p=1$" + salt + "$" + key,
		"too few parts":  "argon2id$v=19$m=19456,t=2,p=1$" + salt,
		"unknown param":  "argon2id$v=19$m=19456,t=2,x=1$" + salt + "$" + key,
		"no value":       "argon2id$v=19$m,t=2,p=1$" + salt + "$" + key,
		"huge memory":    "argon2id$v=19$m=99999999,t=2,p=1$" + salt + "$" + key,
		"huge time":      "argon2id$v=19$m=19456,t=1000,p=1$" + salt + "$" + key,
		"zero threads":   "argon2id$v=19$m=19456,t=2,p=0$" + salt + "$" + key,
		"bad salt":       "argon2id$v=19$m=19456,t=2,p=1$!!!$" + key,
		"short key":      "argon2id$v=19$m=19456,t=2,p=1$" + salt + "$AAAA",
		"negative value": "argon2id$v=19$m=-1,t=2,p=1$" + salt + "$" + key,
	} {
		if _, err := verifyPassword("password", stored); !errors.Is(err, errBadHash) {
			t.Errorf("%s: err = %v, want errBadHash", name, err)
		}
	}
}

func TestCheckNewPassword(t *testing.T) {
	for _, tc := range []struct {
		password string
		ok       bool
	}{
		{"1234567", false},
		{"12345678", true},
		{"èèèèèèèè", true}, // counted in characters, not bytes
		{"èèèè", false},    // 8 bytes but 4 characters
		{strings.Repeat("a", 128), true},
		{strings.Repeat("a", 129), false},
	} {
		err := checkNewPassword(tc.password)
		if (err == nil) != tc.ok {
			t.Errorf("checkNewPassword(%q) = %v, want ok=%v", tc.password, err, tc.ok)
		}
	}
}

// oldHash makes a hash like the old FranzPLAY's: PHP's password_hash writes
// bcrypt with the "$2y$" mark. A low cost keeps the test fast.
func oldHash(t *testing.T, password string) string {
	t.Helper()
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	return "$2y$" + strings.TrimPrefix(string(h), "$2a$")
}

func TestVerifyOldFranzPLAYHashes(t *testing.T) {
	stored := oldHash(t, "pass1") // the old version allowed short passwords
	if !needsRehash(stored) {
		t.Error("an old hash does not ask to be replaced")
	}
	for _, tc := range []struct {
		password string
		want     bool
	}{
		{"pass1", true},
		{"Pass1", false},
		{"", false},
		{strings.Repeat("x", 100), false}, // longer than bcrypt reads
	} {
		got, err := verifyPassword(tc.password, stored)
		if err != nil || got != tc.want {
			t.Errorf("verifyPassword(%q) = %v, %v; want %v", tc.password, got, err, tc.want)
		}
	}

	argon, err := hashPassword("pass1")
	if err != nil {
		t.Fatal(err)
	}
	if needsRehash(argon) {
		t.Error("a new hash asks to be replaced")
	}
}

func TestVerifyRefusesDamagedOrHeavyOldHashes(t *testing.T) {
	good := oldHash(t, "password")
	for name, stored := range map[string]string{
		"cut":        good[:20],
		"cost 31":    "$2y$31$" + good[7:],
		"cost 3":     "$2y$03$" + good[7:],
		"no cost":    "$2y$",
		"other mark": "$2z$" + good[4:],
	} {
		if _, err := verifyPassword("password", stored); !errors.Is(err, errBadHash) {
			t.Errorf("%s: err = %v, want errBadHash", name, err)
		}
	}
}
