package users

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"errors"
	"fmt"
	"hash/fnv"
	"log/slog"
	"net/netip"
	"slices"
	"strings"
	"sync"
	"time"
)

// Errors shown to people, in the API's answers.
var (
	errAlreadySetUp   = errors.New("FranzPLAY is already set up")
	errBadSetupCode   = errors.New("the setup code is not right")
	errBadCredentials = errors.New("wrong name or password")
	errTooManyTries   = errors.New("too many wrong tries: wait and try again")
)

// maxHashing is how many passwords may be checked at the same time. Each
// check takes 19 MB of memory: this keeps a burst of logins from filling
// a 2 GB Raspberry Pi.
const maxHashing = 2

// Service holds everything about users and sessions.
type Service struct {
	store   store
	dataDir string // FranzPLAY's data folder, where profile photos live
	logger  *slog.Logger
	now     func() time.Time
	// registrations counts the accounts people make by themselves.
	registrations *registrations
	hashing       chan struct{} // one slot per password check in progress

	mu sync.Mutex
	// needsAdmin is true until FranzPLAY has its administrator.
	needsAdmin bool
	// setupCode, when not "", must be typed to create the administrator.
	// It exists only when the installer asked for it.
	setupCode string

	// methods are the login methods the server allows, kept in memory
	// (nil until read: see serverMethodsCached).
	methods Methods
	// methodKey picks the method shown for names that do not exist.
	methodKey []byte
	// trusted are the reverse proxies whose X-Forwarded-For is believed.
	trusted []netip.Prefix
	// proxyWarned is set once the log has said that a reverse proxy is
	// in front of FranzPLAY without being among the trusted ones.
	proxyWarned sync.Once

	// nameLocks makes the tries for one name wait for each other, so that
	// many guesses sent at once cannot all pass before the first wrong
	// one is counted. A fixed number of locks, shared by names that fall
	// on the same one, keeps memory the same whatever names are tried.
	nameLocks [64]sync.Mutex

	// dummyHash is checked when a name does not exist, so that answering
	// "wrong name" takes as long as "wrong password" and does not reveal
	// which names exist.
	dummyHash string
}

// NewService prepares the users service. When FranzPLAY has no user yet,
// the first person who opens the site creates the administrator.
//
// With requireSetupCode, that person must also type a one-time code that
// FranzPLAY writes in the log: only someone who can read the log (the
// person who installed it) can then create the administrator. It is for
// servers reachable from the internet before the first setup.
func NewService(ctx context.Context, db *sql.DB, dataDir string, requireSetupCode bool, logger *slog.Logger) (*Service, error) {
	dummy, err := hashPassword("not a real password")
	if err != nil {
		return nil, err
	}
	s := &Service{
		store:         store{db: db},
		dataDir:       dataDir,
		logger:        logger,
		now:           time.Now,
		registrations: newRegistrations(),
		hashing:       make(chan struct{}, maxHashing),
		dummyHash:     dummy,
	}
	if s.methodKey, err = s.store.methodSecret(ctx); err != nil {
		return nil, err
	}
	n, err := s.store.countUsers(ctx)
	if err != nil {
		return nil, err
	}
	switch {
	case n > 0:
	case requireSetupCode:
		code, err := newSetupCode()
		if err != nil {
			return nil, err
		}
		s.needsAdmin, s.setupCode = true, code
		logger.Warn("FranzPLAY has no administrator yet: open the site and use this setup code",
			"setup_code", code)
	default:
		s.needsAdmin = true
		logger.Warn("FranzPLAY has no administrator yet: the first person who opens the site creates it")
	}
	if err := s.store.deleteExpiredSessions(ctx, s.now()); err != nil {
		return nil, err
	}
	return s, nil
}

// newSetupCode makes a code that is easy to type: 3 groups of 4 letters
// and numbers, without the ones that look alike (0/O, 1/I/L).
func newSetupCode() (string, error) {
	const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("setup code: %w", err)
	}
	var sb strings.Builder
	for i, c := range b {
		if i > 0 && i%4 == 0 {
			sb.WriteByte('-')
		}
		sb.WriteByte(alphabet[int(c)%len(alphabet)])
	}
	return sb.String(), nil
}

// needsSetup reports whether FranzPLAY still waits for its administrator.
func (s *Service) needsSetup() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.needsAdmin
}

// needsSetupCode reports whether creating the administrator asks for the
// code written in the log.
func (s *Service) needsSetupCode() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.needsAdmin && s.setupCode != ""
}

// setup creates the administrator, checking the code when there is one.
// It works only once: the database refuses a first user when one exists.
func (s *Service) setup(ctx context.Context, code, name, password string) (Account, error) {
	s.mu.Lock()
	needed, expected := s.needsAdmin, s.setupCode
	s.mu.Unlock()
	if !needed {
		return Account{}, errAlreadySetUp
	}
	if expected != "" {
		given := strings.ToUpper(strings.TrimSpace(code))
		if subtle.ConstantTimeCompare([]byte(given), []byte(expected)) != 1 {
			return Account{}, errBadSetupCode
		}
	}
	a, err := s.create(ctx, name, Password, password, Admin, true, true)
	if err != nil {
		return Account{}, err
	}
	s.mu.Lock()
	s.needsAdmin, s.setupCode = false, ""
	s.mu.Unlock()
	s.logger.InfoContext(ctx, "administrator created", "name", a.Name)
	return a, nil
}

// create checks and adds a user, who logs in with method m and secret.
func (s *Service) create(ctx context.Context, name string, m Method, secret string, role Role, canUpload, first bool) (Account, error) {
	return s.createWith(ctx, Account{Role: role, CanUpload: canUpload, LoginMethod: m}, name, secret, first)
}

// createWith adds a user like a, with its name checked and its secret
// hashed. a.OwnMethods, when set, narrows the methods the user may use.
func (s *Service) createWith(ctx context.Context, a Account, name, secret string, first bool) (Account, error) {
	clean, err := CleanName(name)
	if err != nil {
		return Account{}, err
	}
	if a.LoginMethod == "" {
		a.LoginMethod = Password
	}
	if err := checkNewSecret(a.LoginMethod, secret); err != nil {
		return Account{}, err
	}
	hash, err := s.hash(ctx, secret)
	if err != nil {
		return Account{}, err
	}
	a.Name = clean
	a, err = s.store.createUser(ctx, a, hash, s.now(), first)
	if err != nil {
		return Account{}, err
	}
	return s.withMethods(ctx, a, string(a.LoginMethod), a.OwnMethods.String())
}

// checkFirstSecret controls the method and secret of someone who makes
// their own account: the method must be one the server allows.
func (s *Service) checkFirstSecret(ctx context.Context, m Method, secret string) error {
	if m == "" {
		m = Password
	}
	server, err := s.serverMethodsCached(ctx)
	if err != nil {
		return err
	}
	if !slices.Contains(server, m) {
		return errMethodNotAllowed
	}
	return checkNewSecret(m, secret)
}

// hash makes a password hash, waiting for a free slot.
func (s *Service) hash(ctx context.Context, password string) (string, error) {
	if err := s.acquire(ctx); err != nil {
		return "", err
	}
	defer s.release()
	return hashPassword(password)
}

// verify checks a password, waiting for a free slot.
func (s *Service) verify(ctx context.Context, password, stored string) (bool, error) {
	if err := s.acquire(ctx); err != nil {
		return false, err
	}
	defer s.release()
	return verifyPassword(password, stored)
}

func (s *Service) acquire(ctx context.Context) error {
	select {
	case s.hashing <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Service) release() { <-s.hashing }

// lockName takes the lock of a name's tries and returns how to let it go.
func (s *Service) lockName(key string) (unlock func()) {
	h := fnv.New32a()
	_, _ = h.Write([]byte(key)) // a hash.Hash never fails to write
	m := &s.nameLocks[h.Sum32()%uint32(len(s.nameLocks))]
	m.Lock()
	return m.Unlock
}

// login checks name and password (or PIN, or pattern) and opens a
// session. It returns the cookie token. Every try is written in the access
// log, with the address it came from.
//
// Wrong tries block the name and the address for a while (see blocks.go).
// A name that does not exist is treated like one that does, with the
// decoy method shown at login, so the answers never tell them apart.
//
// With limitAddress false the address is only written in the log: it is
// the address of a reverse proxy that everybody shares (see
// limitsAddress), and blocking it would lock everybody out.
func (s *Service) login(ctx context.Context, address string, limitAddress bool, name, secret string) (Account, string, error) {
	name = strings.TrimSpace(name)
	key := blockKey(name)
	unlock := s.lockName(key)
	defer unlock()
	now := s.now()
	keys, blockAddress := []string{key}, ""
	if limitAddress {
		keys, blockAddress = append(keys, addressKey(address)), address
	}
	if err := s.checkTries(ctx, keys...); err != nil {
		if errors.Is(err, errTooManyTries) {
			if rerr := s.store.recordLogin(ctx, now, name, 0, address, Locked); rerr != nil {
				return Account{}, "", rerr
			}
		}
		return Account{}, "", err
	}

	stored, hash, err := s.store.credentials(ctx, name)
	m := Method(stored.method)
	switch {
	case errors.Is(err, errUserNotFound):
		hash = s.dummyHash
		if m, err = s.methodOf(ctx, name); err != nil {
			return Account{}, "", err
		}
	case err != nil:
		return Account{}, "", err
	}
	ok := false
	if fits(m, secret) {
		if ok, err = s.verify(ctx, secret, hash); err != nil {
			return Account{}, "", err
		}
	}
	if !ok || stored.ID == 0 {
		s.logger.WarnContext(ctx, "login failed", "name", name, "address", address)
		if err := s.store.recordLogin(ctx, now, name, stored.ID, address, WrongPassword); err != nil {
			return Account{}, "", err
		}
		return Account{}, "", s.wrongTry(ctx, key, m, blockAddress)
	}
	if err := s.store.clearBlock(ctx, key); err != nil {
		return Account{}, "", err
	}
	a, err := s.withMethods(ctx, stored.Account, stored.method, stored.own)
	if err != nil {
		return Account{}, "", err
	}
	if needsRehash(hash) {
		s.rehash(ctx, a, secret, hash)
	}

	token, tokenHash, err := newToken()
	if err != nil {
		return Account{}, "", err
	}
	if err := s.store.createSession(ctx, a.ID, tokenHash, now); err != nil {
		return Account{}, "", err
	}
	if err := s.store.recordLogin(ctx, now, name, a.ID, address, Entered); err != nil {
		return Account{}, "", err
	}
	return a, token, nil
}

// rehash replaces a password hash of the old FranzPLAY with a new one,
// now that the password is known. A failure only means trying again at
// the next login, so it is logged and the login goes on.
func (s *Service) rehash(ctx context.Context, a Account, password, stored string) {
	hash, err := s.hash(ctx, password)
	if err == nil {
		err = s.store.replaceHash(ctx, a.ID, stored, hash)
	}
	if err != nil {
		s.logger.ErrorContext(ctx, "update old password hash", "name", a.Name, "error", err)
		return
	}
	s.logger.InfoContext(ctx, "old password hash updated", "name", a.Name)
}

// startSession opens a session for a user who just got created.
func (s *Service) startSession(ctx context.Context, a Account) (string, error) {
	token, hash, err := newToken()
	if err != nil {
		return "", err
	}
	return token, s.store.createSession(ctx, a.ID, hash, s.now())
}

// confirmSecret checks a user's current password, PIN or pattern, before
// a change that needs it. Wrong ones count like wrong logins, so a stolen
// session cannot be used to guess it.
func (s *Service) confirmSecret(ctx context.Context, a Account, current string) error {
	key := blockKey(a.Name)
	if err := s.checkTries(ctx, key); err != nil {
		return err
	}
	stored, hash, err := s.store.byID(ctx, a.ID)
	if err != nil {
		return err
	}
	m := Method(stored.method)
	ok := false
	if fits(m, current) {
		if ok, err = s.verify(ctx, current, hash); err != nil {
			return err
		}
	}
	if !ok {
		s.logger.WarnContext(ctx, "change refused: wrong current secret", "name", a.Name)
		return s.wrongTry(ctx, key, m, "")
	}
	return s.store.clearBlock(ctx, key)
}

// changeCredential checks the current secret and sets a new one, of
// method m: a user may switch to any method they are allowed.
func (s *Service) changeCredential(ctx context.Context, a Account, token, current string, m Method, next string) error {
	if !slices.Contains(a.AllowedMethods, m) {
		return errMethodNotAllowed
	}
	if err := checkNewSecret(m, next); err != nil {
		return err
	}
	if err := s.confirmSecret(ctx, a, current); err != nil {
		return err
	}
	hash, err := s.hash(ctx, next)
	if err != nil {
		return err
	}
	if err := s.store.setPassword(ctx, a.ID, m, hash, hashToken(token)); err != nil {
		return err
	}
	s.logger.InfoContext(ctx, "login method changed", "name", a.Name, "method", m)
	return nil
}

// resetPassword sets a new password, PIN or pattern chosen by an
// administrator, for a user who forgot theirs. Every session of that user
// is closed, except the administrator's own when they reset their own.
func (s *Service) resetPassword(ctx context.Context, admin Account, token string, id int64, m Method, secret string) error {
	if m == "" {
		m = Password
	}
	stored, _, err := s.store.byID(ctx, id)
	if err != nil {
		return err
	}
	user, err := s.withMethods(ctx, stored.Account, stored.method, stored.own)
	if err != nil {
		return err
	}
	if !slices.Contains(user.AllowedMethods, m) {
		return errMethodNotAllowed
	}
	if err := checkNewSecret(m, secret); err != nil {
		return err
	}
	hash, err := s.hash(ctx, secret)
	if err != nil {
		return err
	}
	keep := []byte{}
	if id == admin.ID {
		keep = hashToken(token)
	}
	if err := s.store.setPassword(ctx, id, m, hash, keep); err != nil {
		return err
	}
	// Whoever was blocked starts again: the administrator vouches for them.
	return s.store.clearBlock(ctx, blockKey(user.Name))
}
