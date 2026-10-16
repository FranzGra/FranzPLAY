package users

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"

	"github.com/FranzGra/FranzPLAY/internal/respond"
)

// rename changes a user's own name. The name is also the one used to log
// in, so it follows the same rules as a new user's and must be free.
func (s *Service) rename(ctx context.Context, a Account, name string) (Account, error) {
	clean, err := CleanName(name)
	if err != nil {
		return Account{}, err
	}
	if err := s.store.renameUser(ctx, a.ID, clean); err != nil {
		return Account{}, err
	}
	s.logger.InfoContext(ctx, "user renamed", "id", a.ID, "from", a.Name, "to", clean)
	a.Name = clean
	return a, nil
}

// setAccentColor changes the color a user chose for the interface.
func (s *Service) setAccentColor(ctx context.Context, a Account, color string) (Account, error) {
	c, err := ParseColor(color)
	if err != nil {
		return Account{}, err
	}
	var value any // NULL for FranzPLAY's own color
	if c != "" {
		value = string(c)
	}
	res, err := s.store.db.ExecContext(ctx, `UPDATE users SET accent_color = ? WHERE id = ?`, value, a.ID)
	if err != nil {
		return Account{}, fmt.Errorf("set accent color: %w", err)
	}
	if err := oneRow(res, "set accent color"); err != nil {
		return Account{}, err
	}
	a.AccentColor = c
	return a, nil
}

// renameUser changes a name, if no other user has it. A user may change
// only the capitals of their own name ("giulia" to "Giulia").
func (s store) renameUser(ctx context.Context, id int64, name string) (err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("rename user: %w", err)
	}
	defer func() { err = finish(tx, err) }()

	var taken int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE name = ? AND id != ?`, name, id).
		Scan(&taken); err != nil {
		return fmt.Errorf("rename user: %w", err)
	}
	if taken > 0 {
		return errNameTaken
	}
	res, err := tx.ExecContext(ctx, `UPDATE users SET name = ? WHERE id = ?`, name, id)
	if err != nil {
		return fmt.Errorf("rename user: %w", err)
	}
	return oneRow(res, "rename user")
}

// oneRow checks that a change touched its user: none means the user is gone.
func oneRow(res sql.Result, what string) error {
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("%s: %w", what, err)
	}
	if n == 0 {
		return errUserNotFound
	}
	return nil
}

// deleteMyself removes a user's own account, after checking the password
// once more: an open browser left on a table must not be enough to wipe an
// account. Wrong passwords count like wrong logins. The last administrator
// cannot leave, or nobody could manage FranzPLAY.
func (s *Service) deleteMyself(ctx context.Context, a Account, password string) error {
	if err := s.confirmSecret(ctx, a, password); err != nil {
		return err
	}
	if err := s.store.deleteUser(ctx, a.ID); err != nil {
		return err
	}
	s.forgetAvatar(ctx, a.ID)
	s.logger.InfoContext(ctx, "user deleted their own account", "id", a.ID, "name", a.Name)
	return nil
}

type nameRequest struct {
	Name string `json:"name"`
}

func (s *Service) handleRename(w http.ResponseWriter, r *http.Request) {
	a, ok := FromContext(r.Context())
	if !ok {
		respond.Error(w, r, s.logger, http.StatusUnauthorized, "login required")
		return
	}
	var req nameRequest
	if err := readJSON(w, r, &req); err != nil {
		s.badRequest(w, r)
		return
	}
	a, err := s.rename(r.Context(), a, req.Name)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	respond.JSON(w, r, s.logger, http.StatusOK, a)
}

type deleteMeRequest struct {
	Password string `json:"password"`
}

func (s *Service) handleDeleteMe(w http.ResponseWriter, r *http.Request) {
	a, ok := FromContext(r.Context())
	if !ok {
		respond.Error(w, r, s.logger, http.StatusUnauthorized, "login required")
		return
	}
	var req deleteMeRequest
	if err := readJSON(w, r, &req); err != nil {
		s.badRequest(w, r)
		return
	}
	err := s.deleteMyself(r.Context(), a, req.Password)
	if errors.Is(err, errBadCredentials) {
		// Not 401, as for the password change: the person is still logged in.
		respond.Error(w, r, s.logger, http.StatusForbidden, "the password is not right")
		return
	}
	if err != nil {
		s.fail(w, r, err)
		return
	}
	clearCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

type colorRequest struct {
	Color string `json:"color"`
}

func (s *Service) handleAccentColor(w http.ResponseWriter, r *http.Request) {
	a, ok := FromContext(r.Context())
	if !ok {
		respond.Error(w, r, s.logger, http.StatusUnauthorized, "login required")
		return
	}
	var req colorRequest
	if err := readJSON(w, r, &req); err != nil {
		s.badRequest(w, r)
		return
	}
	a, err := s.setAccentColor(r.Context(), a, req.Color)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	respond.JSON(w, r, s.logger, http.StatusOK, a)
}

type skipRequest struct {
	Seconds int `json:"seconds"`
}

func (s *Service) handleSkipSeconds(w http.ResponseWriter, r *http.Request) {
	a, ok := FromContext(r.Context())
	if !ok {
		respond.Error(w, r, s.logger, http.StatusUnauthorized, "login required")
		return
	}
	var req skipRequest
	if err := readJSON(w, r, &req); err != nil {
		s.badRequest(w, r)
		return
	}
	a, err := s.setSkipSeconds(r.Context(), a, req.Seconds)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	respond.JSON(w, r, s.logger, http.StatusOK, a)
}
