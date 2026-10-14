// Package users handles the people who use FranzPLAY: the first setup,
// logging in and out, sessions, and the administrator's user list.
package users

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

// Passwords are never stored. FranzPLAY stores a hash made with Argon2id:
// a slow, memory-hungry calculation that is easy to check for one password
// but very expensive for someone trying millions of guesses on a stolen
// database.
const (
	argonKeyLen = 32
	saltLen     = 16
)

// hashCost is how heavy a new password hash is: the minimum OWASP
// recommends, about a quarter of a second on a Raspberry Pi 4. It is a
// variable only so that tests can make it light and run fast.
var hashCost = productionCost

var productionCost = argonCost{time: 2, memory: 19 * 1024, threads: 1}

type argonCost struct {
	time    uint32
	memory  uint32 // KiB
	threads uint8
}

// Password length limits, in characters. The upper limit stops someone
// from making the server hash a huge text.
const (
	minPasswordLen = 8
	maxPasswordLen = 128
)

// errWeakPassword means a new password is too short or too long.
var errWeakPassword = fmt.Errorf("the password must be from %d to %d characters", minPasswordLen, maxPasswordLen)

// checkNewPassword controls a password chosen by a user.
func checkNewPassword(password string) error {
	n := utf8.RuneCountInString(password)
	if n < minPasswordLen || n > maxPasswordLen {
		return errWeakPassword
	}
	return nil
}

// hashPassword returns the text stored in the database for a password:
// "argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>". The settings are inside,
// so they can grow one day without breaking old hashes.
func hashPassword(password string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	c := hashCost
	key := argon2.IDKey([]byte(password), salt, c.time, c.memory, c.threads, argonKeyLen)
	return fmt.Sprintf("argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, c.memory, c.time, c.threads,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

// errBadHash means a stored hash is damaged.
var errBadHash = errors.New("stored password hash is not readable")

// verifyPassword reports whether password matches the stored hash. Besides
// FranzPLAY's own hashes it reads the bcrypt hashes of the old FranzPLAY
// ("$2y$10$…"), so people brought over by the import keep their password.
func verifyPassword(password, stored string) (bool, error) {
	if isBcrypt(stored) {
		return verifyBcrypt(password, stored)
	}
	p, err := parseHash(stored)
	if err != nil {
		return false, err
	}
	key := argon2.IDKey([]byte(password), p.salt, p.time, p.memory, p.threads, uint32(len(p.key))) // len(p.key) is at most 64: see parseHash
	// Compared in constant time, so timing reveals nothing about the hash.
	return subtle.ConstantTimeCompare(key, p.key) == 1, nil
}

type hashParams struct {
	time, memory uint32
	threads      uint8
	salt, key    []byte
}

func parseHash(stored string) (hashParams, error) {
	parts := strings.Split(stored, "$")
	if len(parts) != 5 || parts[0] != "argon2id" || parts[1] != "v="+strconv.Itoa(argon2.Version) {
		return hashParams{}, errBadHash
	}
	var p hashParams
	var memory, time, threads uint64
	for _, kv := range strings.Split(parts[2], ",") {
		k, v, ok := strings.Cut(kv, "=")
		if !ok {
			return hashParams{}, errBadHash
		}
		n, err := strconv.ParseUint(v, 10, 32)
		if err != nil {
			return hashParams{}, errBadHash
		}
		switch k {
		case "m":
			memory = n
		case "t":
			time = n
		case "p":
			threads = n
		default:
			return hashParams{}, errBadHash
		}
	}
	// Refuse settings that would make checking a password absurdly heavy.
	if memory < 1 || memory > 1<<20 || time < 1 || time > 100 || threads < 1 || threads > 16 {
		return hashParams{}, errBadHash
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil || len(salt) < 8 {
		return hashParams{}, errBadHash
	}
	key, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(key) < 16 || len(key) > 64 {
		return hashParams{}, errBadHash
	}
	p.memory, p.time, p.threads = uint32(memory), uint32(time), uint8(threads)
	p.salt, p.key = salt, key
	return p, nil
}

// Bcrypt costs accepted from the old FranzPLAY. PHP uses 10; a higher
// cost doubles the work at each step, so a damaged hash with cost 31
// could keep the server busy for hours.
const (
	minBcryptCost = 4
	maxBcryptCost = 14
)

// isBcrypt reports whether a stored hash comes from the old FranzPLAY.
func isBcrypt(stored string) bool {
	for _, mark := range []string{"$2a$", "$2b$", "$2y$"} {
		if strings.HasPrefix(stored, mark) {
			return true
		}
	}
	return false
}

// needsRehash reports whether a stored hash should be replaced by a new
// Argon2id one, the next time the password is known (at login).
func needsRehash(stored string) bool {
	return isBcrypt(stored)
}

func verifyBcrypt(password, stored string) (bool, error) {
	cost, err := bcrypt.Cost([]byte(stored))
	if err != nil || cost < minBcryptCost || cost > maxBcryptCost {
		return false, errBadHash
	}
	err = bcrypt.CompareHashAndPassword([]byte(stored), []byte(password))
	switch {
	case err == nil:
		return true, nil
	case errors.Is(err, bcrypt.ErrMismatchedHashAndPassword), errors.Is(err, bcrypt.ErrPasswordTooLong):
		return false, nil
	default:
		return false, errBadHash
	}
}
