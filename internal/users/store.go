package users

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// Account is a user as the rest of FranzPLAY sees it.
type Account struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Role      Role   `json:"role"`
	CanUpload bool   `json:"canUpload"`
}

// Store errors.
var (
	errNameTaken    = errors.New("this name is already used")
	errUserNotFound = errors.New("user not found")
	errLastAdmin    = errors.New("the last administrator cannot be removed")
)

// store reads and writes users and sessions.
type store struct {
	db *sql.DB
}

func (s store) countUsers(ctx context.Context) (int, error) {
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM users`).Scan(&n); err != nil {
		return 0, fmt.Errorf("count users: %w", err)
	}
	return n, nil
}

// createUser adds a user. onlyIfNone makes it fail when any user exists,
// for the first setup: checked and written in one transaction.
func (s store) createUser(ctx context.Context, a Account, hash string, now time.Time, onlyIfNone bool) (_ Account, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Account{}, fmt.Errorf("create user: %w", err)
	}
	defer func() { err = finish(tx, err) }()

	if onlyIfNone {
		var n int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM users`).Scan(&n); err != nil {
			return Account{}, fmt.Errorf("create user: %w", err)
		}
		if n > 0 {
			return Account{}, errAlreadySetUp
		}
	}
	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE name = ?`, a.Name).Scan(&exists); err != nil {
		return Account{}, fmt.Errorf("create user: %w", err)
	}
	if exists > 0 {
		return Account{}, errNameTaken
	}
	res, err := tx.ExecContext(ctx, `INSERT INTO users (name, password_hash, role, can_upload, created_at) VALUES (?, ?, ?, ?, ?)`,
		a.Name, hash, string(a.Role), a.CanUpload, now.Unix())
	if err != nil {
		return Account{}, fmt.Errorf("create user: %w", err)
	}
	if a.ID, err = res.LastInsertId(); err != nil {
		return Account{}, fmt.Errorf("create user: %w", err)
	}
	return a, nil
}

// credentials returns a user and its password hash, by name.
func (s store) credentials(ctx context.Context, name string) (Account, string, error) {
	var a Account
	var hash, role string
	err := s.db.QueryRowContext(ctx, `SELECT id, name, role, can_upload, password_hash FROM users WHERE name = ?`, name).
		Scan(&a.ID, &a.Name, &role, &a.CanUpload, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, "", errUserNotFound
	}
	if err != nil {
		return Account{}, "", fmt.Errorf("read user: %w", err)
	}
	r, ok := parseRole(role)
	if !ok {
		return Account{}, "", fmt.Errorf("user %d has unknown role %q", a.ID, role)
	}
	a.Role = r
	return a, hash, nil
}

// passwordHash returns the stored hash of a user, by id.
func (s store) passwordHash(ctx context.Context, id int64) (string, error) {
	var hash string
	err := s.db.QueryRowContext(ctx, `SELECT password_hash FROM users WHERE id = ?`, id).Scan(&hash)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errUserNotFound
	}
	if err != nil {
		return "", fmt.Errorf("read user: %w", err)
	}
	return hash, nil
}

func (s store) list(ctx context.Context) (_ []Account, err error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, role, can_upload FROM users ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := []Account{}
	for rows.Next() {
		var a Account
		var role string
		if err := rows.Scan(&a.ID, &a.Name, &role, &a.CanUpload); err != nil {
			return nil, fmt.Errorf("list users: %w", err)
		}
		r, ok := parseRole(role)
		if !ok {
			return nil, fmt.Errorf("user %d has unknown role %q", a.ID, role)
		}
		a.Role = r
		out = append(out, a)
	}
	return out, rows.Err()
}

// deleteUser removes a user and, through the database, their sessions.
// The last administrator cannot be removed, or nobody could manage FranzPLAY.
func (s store) deleteUser(ctx context.Context, id int64) (err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("delete user: %w", err)
	}
	defer func() { err = finish(tx, err) }()

	var role string
	err = tx.QueryRowContext(ctx, `SELECT role FROM users WHERE id = ?`, id).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return errUserNotFound
	}
	if err != nil {
		return fmt.Errorf("delete user: %w", err)
	}
	if Role(role) == Admin {
		var admins int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE role = 'admin'`).Scan(&admins); err != nil {
			return fmt.Errorf("delete user: %w", err)
		}
		if admins <= 1 {
			return errLastAdmin
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, id); err != nil {
		return fmt.Errorf("delete user: %w", err)
	}
	return nil
}

// setPassword changes a password and closes every session of the user
// except keep (the browser that made the change), so a stolen session
// stops working.
func (s store) setPassword(ctx context.Context, id int64, hash string, keep []byte) (err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("set password: %w", err)
	}
	defer func() { err = finish(tx, err) }()
	if _, err := tx.ExecContext(ctx, `UPDATE users SET password_hash = ? WHERE id = ?`, hash, id); err != nil {
		return fmt.Errorf("set password: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ? AND token_hash != ?`, id, keep); err != nil {
		return fmt.Errorf("set password: %w", err)
	}
	return nil
}

// finish commits the transaction when err is nil, and rolls it back otherwise.
func finish(tx *sql.Tx, err error) error {
	if err != nil {
		if rbErr := tx.Rollback(); rbErr != nil {
			return errors.Join(err, fmt.Errorf("rollback: %w", rbErr))
		}
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}
