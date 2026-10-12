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
)

// Passwords are never stored. FranzPLAY stores a hash made with Argon2id:
// a slow, memory-hungry calculation that is easy to check for one password
// but very expensive for someone trying millions of guesses on a stolen
// database. The settings are the minimum OWASP recommends, which takes
// about a quarter of a second on a Raspberry Pi 4.
const (
	argonTime    = 2
	argonMemory  = 19 * 1024 // KiB
	argonThreads = 1
	argonKeyLen  = 32
	saltLen      = 16
)

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
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

// errBadHash means a stored hash is damaged.
var errBadHash = errors.New("stored password hash is not readable")

// verifyPassword reports whether password matches the stored hash.
func verifyPassword(password, stored string) (bool, error) {
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
