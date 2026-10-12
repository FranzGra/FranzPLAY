package users

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/respond"
)

// keyOpenRegistration is the settings row that says whether anyone may
// create an account by themselves. Missing means no: a new FranzPLAY lets
// people in only with an invite or when the administrator creates them.
const keyOpenRegistration = "users.open_registration"

// Registration errors shown to people.
var (
	errRegistrationClosed = errors.New("new accounts can be made only with an invite")
	errTooManyAccounts    = errors.New("too many new accounts from here: wait a few minutes and try again")
)

// Accounts made by registering, from the same address: at most
// maxRegistrations in registrationWindow, as the old FranzPLAY did. It
// stops a script from filling FranzPLAY with accounts.
const (
	maxRegistrations   = 5
	registrationWindow = 5 * time.Minute
)

// recentRegistrations keeps only the times still inside the window, the
// oldest first. Pure: easy to test.
func recentRegistrations(times []time.Time, now time.Time) []time.Time {
	from := now.Add(-registrationWindow)
	for len(times) > 0 && !times[0].After(from) {
		times = times[1:]
	}
	return times
}

// registrations remembers when accounts were made, per address, in memory
// only: after a restart everybody starts from zero, which is fine.
type registrations struct {
	mu     sync.Mutex
	byAddr map[string][]time.Time
}

func newRegistrations() *registrations {
	return &registrations{byAddr: map[string][]time.Time{}}
}

// take counts one more account from addr, if the address has not made too
// many lately.
func (g *registrations) take(addr string, now time.Time) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if len(g.byAddr) >= maxTracked { // keep the memory small
		for k, times := range g.byAddr {
			if len(recentRegistrations(times, now)) == 0 {
				delete(g.byAddr, k)
			}
		}
	}
	times := recentRegistrations(g.byAddr[addr], now)
	if len(times) >= maxRegistrations {
		g.byAddr[addr] = times
		return false
	}
	g.byAddr[addr] = append(times, now)
	return true
}

// clientAddr is the address the request comes from, without the port.
func clientAddr(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// openRegistration says whether anyone may create an account by themselves.
func (s store) openRegistration(ctx context.Context) (bool, error) {
	var value string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, keyOpenRegistration).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read registration setting: %w", err)
	}
	return value == "on", nil
}

func (s store) setOpenRegistration(ctx context.Context, open bool) error {
	value := "off"
	if open {
		value = "on"
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value`, keyOpenRegistration, value); err != nil {
		return fmt.Errorf("save registration setting: %w", err)
	}
	return nil
}

// register creates the account of someone who signs up by themselves,
// when the administrator allows it. They get a normal account that
// cannot upload videos: the administrator decides that later.
func (s *Service) register(ctx context.Context, addr, name, password string) (Account, error) {
	open, err := s.store.openRegistration(ctx)
	if err != nil {
		return Account{}, err
	}
	if !open {
		return Account{}, errRegistrationClosed
	}
	// Mistakes in the form are checked before counting the account, so
	// they do not use up the tries.
	if _, err := cleanName(name); err != nil {
		return Account{}, err
	}
	if err := checkNewPassword(password); err != nil {
		return Account{}, err
	}
	if !s.registrations.take(addr, s.now()) {
		return Account{}, errTooManyAccounts
	}
	return s.create(ctx, name, password, User, false, false)
}

// registration is what the administrator sees and changes.
type registration struct {
	Open bool `json:"open"`
}

func (s *Service) handleRegistration(w http.ResponseWriter, r *http.Request) {
	open, err := s.store.openRegistration(r.Context())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	respond.JSON(w, r, s.logger, http.StatusOK, registration{Open: open})
}

func (s *Service) handleSetRegistration(w http.ResponseWriter, r *http.Request) {
	var req registration
	if err := readJSON(w, r, &req); err != nil {
		s.badRequest(w, r)
		return
	}
	if err := s.store.setOpenRegistration(r.Context(), req.Open); err != nil {
		s.fail(w, r, err)
		return
	}
	admin, _ := FromContext(r.Context())
	s.logger.InfoContext(r.Context(), "registration changed", "open", req.Open, "by", admin.Name)
	respond.JSON(w, r, s.logger, http.StatusOK, req)
}

type registerRequest struct {
	Name     string `json:"name"`
	Password string `json:"password"`
}

func (s *Service) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := readJSON(w, r, &req); err != nil {
		s.badRequest(w, r)
		return
	}
	a, err := s.register(r.Context(), clientAddr(r), req.Name, req.Password)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	token, err := s.startSession(r.Context(), a)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.logger.InfoContext(r.Context(), "registered", "name", a.Name)
	setCookie(w, r, token)
	respond.JSON(w, r, s.logger, http.StatusCreated, a)
}
