package users

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"

	"github.com/FranzGra/FranzPLAY/internal/respond"
)

// rename changes a user's own name. The name is also the one used to log
// in, so it follows the same rules as a new user's and must be free.
func (s *Service) rename(ctx context.Context, a Account, name string) (Account, error) {
	clean, err := cleanName(name)
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
