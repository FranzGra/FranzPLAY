package users

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"strings"
)

// Method is how a person proves who they are. The list is closed.
type Method string

// The methods. A PIN and a pattern are quicker to type on a television or
// a phone, but much easier to guess than a password: they get fewer tries
// before a block (see policyFor).
const (
	Password Method = "password"
	PIN      Method = "pin"     // exactly pinLen digits
	Pattern  Method = "pattern" // dots of a 3×3 grid, numbered 1 to 9 row by row
)

// allMethods is every method, in the order the interface shows them.
var allMethods = []Method{Password, PIN, Pattern}

// PIN and pattern rules.
const (
	pinLen        = 6
	minPatternLen = 5
	maxPatternLen = 9 // every dot once
)

// Errors about methods, shown to people.
var (
	errBadPIN           = fmt.Errorf("the PIN must be exactly %d digits", pinLen)
	errBadPattern       = fmt.Errorf("the pattern must join from %d to %d different dots", minPatternLen, maxPatternLen)
	errMethodNotAllowed = errors.New("this login method is not allowed for this account")
	errBadMethods       = errors.New("choose at least one login method among password, pin and pattern")
	errMustChoose       = errors.New("your login method is no longer allowed: choose a new one in your profile")
)

func parseMethod(s string) (Method, bool) {
	m := Method(s)
	return m, slices.Contains(allMethods, m)
}

// checkNewSecret controls a new password, PIN or pattern. A pattern is
// the numbers of its dots in order, like "14789".
func checkNewSecret(m Method, secret string) error {
	switch m {
	case Password:
		return checkNewPassword(secret)
	case PIN:
		if !isPIN(secret) {
			return errBadPIN
		}
		return nil
	case Pattern:
		if !isPattern(secret) {
			return errBadPattern
		}
		return nil
	default:
		return errMethodNotAllowed
	}
}

// fits reports whether a typed secret could be of method m at all. A
// login that does not fit is wrong without even checking the hash.
func fits(m Method, secret string) bool {
	switch m {
	case PIN:
		return isPIN(secret)
	case Pattern:
		return isPattern(secret)
	default:
		return len(secret) <= 4*maxPasswordLen
	}
}

func isPIN(s string) bool {
	if len(s) != pinLen {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func isPattern(s string) bool {
	if len(s) < minPatternLen || len(s) > maxPatternLen {
		return false
	}
	var seen [10]bool
	for _, c := range s {
		if c < '1' || c > '9' || seen[c-'0'] {
			return false
		}
		seen[c-'0'] = true
	}
	return true
}

// Methods is a set of methods, kept in the order of allMethods.
type Methods []Method

// parseMethods reads a list like "password,pin", as kept in the database.
func parseMethods(s string) (Methods, error) {
	var out Methods
	for _, part := range strings.Split(s, ",") {
		m, ok := parseMethod(strings.TrimSpace(part))
		if !ok {
			return nil, fmt.Errorf("unknown login method %q", part)
		}
		out = append(out, m)
	}
	return normalize(out)
}

// normalize sorts methods, refusing an empty list and unknown methods.
func normalize(list []Method) (Methods, error) {
	var out Methods
	for _, m := range allMethods {
		if slices.Contains(list, m) {
			out = append(out, m)
		}
	}
	for _, m := range list {
		if !slices.Contains(allMethods, m) {
			return nil, errBadMethods
		}
	}
	if len(out) == 0 {
		return nil, errBadMethods
	}
	return out, nil
}

func (ms Methods) String() string {
	parts := make([]string, len(ms))
	for i, m := range ms {
		parts[i] = string(m)
	}
	return strings.Join(parts, ",")
}

// effective is what a person may use: their own list, when the
// administrator narrowed it, inside what the server allows. When the two
// have nothing in common (the server dropped every method the person had),
// the server's list wins: nobody is left without a way in.
func effective(server, own Methods) Methods {
	if len(own) == 0 {
		return server
	}
	var out Methods
	for _, m := range own {
		if slices.Contains(server, m) {
			out = append(out, m)
		}
	}
	if len(out) == 0 {
		return server
	}
	return out
}

// keyLoginMethods is the settings row with the methods the server allows.
// Missing means all of them.
const keyLoginMethods = "users.login_methods"

// keyMethodSecret is the settings row with the random key that picks a
// method for names that do not exist (see decoyMethod).
const keyMethodSecret = "users.method_secret"

func (s store) serverMethods(ctx context.Context) (Methods, error) {
	var value string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, keyLoginMethods).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return slices.Clone(Methods(allMethods)), nil
	}
	if err != nil {
		return nil, fmt.Errorf("read login methods: %w", err)
	}
	return parseMethods(value)
}

func (s store) setServerMethods(ctx context.Context, ms Methods) error {
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value`, keyLoginMethods, ms.String()); err != nil {
		return fmt.Errorf("save login methods: %w", err)
	}
	return nil
}

// methodSecret returns the key of decoyMethod, making it the first time.
// It is kept in the database so that a name that does not exist gets the
// same answer before and after a restart.
func (s store) methodSecret(ctx context.Context) ([]byte, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, fmt.Errorf("method secret: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING`,
		keyMethodSecret, hex.EncodeToString(b)); err != nil {
		return nil, fmt.Errorf("method secret: %w", err)
	}
	var value string
	if err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, keyMethodSecret).Scan(&value); err != nil {
		return nil, fmt.Errorf("method secret: %w", err)
	}
	key, err := hex.DecodeString(value)
	if err != nil || len(key) < 16 {
		return nil, errors.New("method secret: stored value is not readable")
	}
	return key, nil
}

// decoyMethod is the method shown for a name that does not exist: always
// the same for the same name, picked among the ones the server allows,
// so that asking for the method of a name does not tell whether it exists.
func decoyMethod(secret []byte, name string, server Methods) Method {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(strings.ToLower(name)))
	sum := mac.Sum(nil)
	return server[int(sum[0])%len(server)]
}

// methodOf returns the method to ask a name for at login: its own, or a
// decoy for names that do not exist.
func (s *Service) methodOf(ctx context.Context, name string) (Method, error) {
	name = strings.TrimSpace(name)
	var stored string
	err := s.store.db.QueryRowContext(ctx, `SELECT login_method FROM users WHERE name = ?`, name).Scan(&stored)
	if err == nil {
		m, ok := parseMethod(stored)
		if !ok {
			return "", fmt.Errorf("user %q has unknown login method %q", name, stored)
		}
		return m, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("read login method: %w", err)
	}
	server, err := s.serverMethodsCached(ctx)
	if err != nil {
		return "", err
	}
	return decoyMethod(s.methodKey, name, server), nil
}

// serverMethodsCached returns the server's methods, read from the database
// once and then kept in memory: they are needed at every request.
func (s *Service) serverMethodsCached(ctx context.Context) (Methods, error) {
	s.mu.Lock()
	cached := s.methods
	s.mu.Unlock()
	if cached != nil {
		return cached, nil
	}
	ms, err := s.store.serverMethods(ctx)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.methods = ms
	s.mu.Unlock()
	return ms, nil
}

// setServerMethods changes the methods allowed on the whole server.
func (s *Service) setServerMethods(ctx context.Context, list []Method) (Methods, error) {
	ms, err := normalize(list)
	if err != nil {
		return nil, err
	}
	if err := s.store.setServerMethods(ctx, ms); err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.methods = ms
	s.mu.Unlock()
	return ms, nil
}

// withMethods fills the method fields of an account from what is stored.
func (s *Service) withMethods(ctx context.Context, a Account, method, own string) (Account, error) {
	m, ok := parseMethod(method)
	if !ok {
		return Account{}, fmt.Errorf("user %d has unknown login method %q", a.ID, method)
	}
	server, err := s.serverMethodsCached(ctx)
	if err != nil {
		return Account{}, err
	}
	var mine Methods
	if own != "" {
		if mine, err = parseMethods(own); err != nil {
			return Account{}, fmt.Errorf("user %d: %w", a.ID, err)
		}
	}
	a.LoginMethod = m
	a.OwnMethods = mine
	a.AllowedMethods = effective(server, mine)
	a.MustChooseMethod = !slices.Contains(a.AllowedMethods, m)
	return a, nil
}
