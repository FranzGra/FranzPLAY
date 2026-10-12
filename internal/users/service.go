package users

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"
)

// Errors shown to people, in the API's answers.
var (
	errAlreadySetUp   = errors.New("FranzPLAY is already set up")
	errBadSetupCode   = errors.New("the setup code is not right")
	errBadCredentials = errors.New("wrong name or password")
	errTooManyTries   = errors.New("too many wrong passwords: wait a minute and try again")
)

// maxHashing is how many passwords may be checked at the same time. Each
// check takes 19 MB of memory: this keeps a burst of logins from filling
// a 2 GB Raspberry Pi.
const maxHashing = 2

// Service holds everything about users and sessions.
type Service struct {
	store   store
	logger  *slog.Logger
	now     func() time.Time
	limiter *limiter
	hashing chan struct{} // one slot per password check in progress

	mu        sync.Mutex
	setupCode string // "" once FranzPLAY has its administrator

	// dummyHash is checked when a name does not exist, so that answering
	// "wrong name" takes as long as "wrong password" and does not reveal
	// which names exist.
	dummyHash string
}

// NewService prepares the users service. When FranzPLAY has no user yet it
// makes a one-time setup code and writes it in the log: only someone who
// can read the log (the person who installed FranzPLAY) can create the
// administrator, not just anyone on the network who opens the page first.
func NewService(ctx context.Context, db *sql.DB, logger *slog.Logger) (*Service, error) {
	dummy, err := hashPassword("not a real password")
	if err != nil {
		return nil, err
	}
	s := &Service{
		store:     store{db: db},
		logger:    logger,
		now:       time.Now,
		limiter:   newLimiter(),
		hashing:   make(chan struct{}, maxHashing),
		dummyHash: dummy,
	}
	n, err := s.store.countUsers(ctx)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		code, err := newSetupCode()
		if err != nil {
			return nil, err
		}
		s.setupCode = code
		logger.Warn("FranzPLAY has no administrator yet: open the site and use this setup code",
			"setup_code", code)
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
	return s.setupCode != ""
}

// setup creates the administrator, if the code is right.
func (s *Service) setup(ctx context.Context, code, name, password string) (Account, error) {
	s.mu.Lock()
	expected := s.setupCode
	s.mu.Unlock()
	if expected == "" {
		return Account{}, errAlreadySetUp
	}
	given := strings.ToUpper(strings.TrimSpace(code))
	if subtle.ConstantTimeCompare([]byte(given), []byte(expected)) != 1 {
		return Account{}, errBadSetupCode
	}
	a, err := s.create(ctx, name, password, Admin, true, true)
	if err != nil {
		return Account{}, err
	}
	s.mu.Lock()
	s.setupCode = ""
	s.mu.Unlock()
	s.logger.InfoContext(ctx, "administrator created", "name", a.Name)
	return a, nil
}

// create checks and adds a user.
func (s *Service) create(ctx context.Context, name, password string, role Role, canUpload, first bool) (Account, error) {
	clean, err := cleanName(name)
	if err != nil {
		return Account{}, err
	}
	if err := checkNewPassword(password); err != nil {
		return Account{}, err
	}
	hash, err := s.hash(ctx, password)
	if err != nil {
		return Account{}, err
	}
	return s.store.createUser(ctx, Account{Name: clean, Role: role, CanUpload: canUpload}, hash, s.now(), first)
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

// login checks name and password and opens a session. It returns the
// cookie token.
func (s *Service) login(ctx context.Context, name, password string) (Account, string, error) {
	name = strings.TrimSpace(name)
	now := s.now()
	if !s.limiter.allowed(name, now) {
		return Account{}, "", errTooManyTries
	}
	if len(password) > 4*maxPasswordLen {
		return Account{}, "", errBadCredentials
	}

	a, stored, err := s.store.credentials(ctx, name)
	switch {
	case errors.Is(err, errUserNotFound):
		stored = s.dummyHash
	case err != nil:
		return Account{}, "", err
	}
	ok, err := s.verify(ctx, password, stored)
	if err != nil {
		return Account{}, "", err
	}
	if !ok || a.ID == 0 {
		s.limiter.failed(name, now)
		s.logger.WarnContext(ctx, "login failed", "name", name)
		return Account{}, "", errBadCredentials
	}
	s.limiter.succeeded(name)

	token, hash, err := newToken()
	if err != nil {
		return Account{}, "", err
	}
	if err := s.store.createSession(ctx, a.ID, hash, now); err != nil {
		return Account{}, "", err
	}
	return a, token, nil
}

// startSession opens a session for a user who just got created.
func (s *Service) startSession(ctx context.Context, a Account) (string, error) {
	token, hash, err := newToken()
	if err != nil {
		return "", err
	}
	return token, s.store.createSession(ctx, a.ID, hash, s.now())
}

// changePassword checks the current password and sets a new one.
// Wrong current passwords count like wrong logins, so a stolen session
// cannot be used to guess the password.
func (s *Service) changePassword(ctx context.Context, a Account, token, current, next string) error {
	if err := checkNewPassword(next); err != nil {
		return err
	}
	now := s.now()
	if !s.limiter.allowed(a.Name, now) {
		return errTooManyTries
	}
	stored, err := s.store.passwordHash(ctx, a.ID)
	if err != nil {
		return err
	}
	ok, err := s.verify(ctx, current, stored)
	if err != nil {
		return err
	}
	if !ok {
		s.limiter.failed(a.Name, now)
		s.logger.WarnContext(ctx, "password change refused: wrong current password", "name", a.Name)
		return errBadCredentials
	}
	s.limiter.succeeded(a.Name)
	hash, err := s.hash(ctx, next)
	if err != nil {
		return err
	}
	return s.store.setPassword(ctx, a.ID, hash, hashToken(token))
}

// resetPassword sets a new password chosen by an administrator, for a user
// who forgot theirs. Every session of that user is closed, except the
// administrator's own when they reset their own password.
func (s *Service) resetPassword(ctx context.Context, admin Account, token string, id int64, password string) error {
	if err := checkNewPassword(password); err != nil {
		return err
	}
	hash, err := s.hash(ctx, password)
	if err != nil {
		return err
	}
	keep := []byte{}
	if id == admin.ID {
		keep = hashToken(token)
	}
	return s.store.setPassword(ctx, id, hash, keep)
}
