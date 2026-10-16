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
	// CanSharePublic lets the user make public links, which anybody may
	// open without an account. Off until the administrator turns it on;
	// administrators may always (see MaySharePublic).
	CanSharePublic bool `json:"canSharePublic"`
	// UploadQuota is how many bytes of uploaded videos the user may keep.
	UploadQuota int64 `json:"uploadQuota"`
	// AccentColor is the color the user chose for the interface; "" means
	// FranzPLAY's own.
	AccentColor Color `json:"accentColor"`
	// Avatar is the version of the user's profile photo, 0 when there is
	// none: the interface shows the initial of the name instead.
	Avatar int64 `json:"avatar"`
	// SkipSeconds is how far the player jumps forward or back for the
	// user: one of SkipChoices.
	SkipSeconds int `json:"skipSeconds"`
}

// MaySharePublic reports whether the user may make public links.
func (a Account) MaySharePublic() bool { return a.Role == Admin || a.CanSharePublic }

// Limits of the upload quota: a person starts with DefaultUploadQuota and
// the administrator can choose from MinUploadQuota to MaxUploadQuota.
const (
	DefaultUploadQuota int64 = 10 << 30  // 10 GiB, also the database default
	MinUploadQuota     int64 = 1 << 30   // 1 GiB
	MaxUploadQuota     int64 = 100 << 40 // 100 TiB: more than any home disk
)

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
	return insertUser(ctx, tx, a, hash, now)
}

// insertUser adds a user inside a transaction, if the name is free.
func insertUser(ctx context.Context, tx *sql.Tx, a Account, hash string, now time.Time) (Account, error) {
	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE name = ?`, a.Name).Scan(&exists); err != nil {
		return Account{}, fmt.Errorf("create user: %w", err)
	}
	if exists > 0 {
		return Account{}, errNameTaken
	}
	if a.UploadQuota == 0 {
		a.UploadQuota = DefaultUploadQuota
	}
	a.SkipSeconds = DefaultSkip // the database default
	res, err := tx.ExecContext(ctx, `
		INSERT INTO users (name, password_hash, role, can_upload, upload_quota, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		a.Name, hash, string(a.Role), a.CanUpload, a.UploadQuota, now.Unix())
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
	err := s.db.QueryRowContext(ctx, `
		SELECT id, name, role, can_upload, can_share_public, upload_quota, coalesce(accent_color, ''), avatar, skip_seconds, password_hash FROM users WHERE name = ?`, name).
		Scan(&a.ID, &a.Name, &role, &a.CanUpload, &a.CanSharePublic, &a.UploadQuota, &a.AccentColor, &a.Avatar, &a.SkipSeconds, &hash)
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

// Person is a user as the administrator sees them in the list of people.
type Person struct {
	Account
	LastLogin *time.Time `json:"lastLogin"` // nil if they never logged in with name and password
}

func (s store) list(ctx context.Context) (_ []Person, err error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, role, can_upload, can_share_public, upload_quota, coalesce(accent_color, ''), avatar, skip_seconds, last_login FROM users ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := []Person{}
	for rows.Next() {
		var p Person
		var role string
		var last sql.NullInt64
		if err := rows.Scan(&p.ID, &p.Name, &role, &p.CanUpload, &p.CanSharePublic, &p.UploadQuota, &p.AccentColor, &p.Avatar, &p.SkipSeconds, &last); err != nil {
			return nil, fmt.Errorf("list users: %w", err)
		}
		r, ok := parseRole(role)
		if !ok {
			return nil, fmt.Errorf("user %d has unknown role %q", p.ID, role)
		}
		p.Role = r
		if last.Valid {
			t := time.Unix(last.Int64, 0).UTC()
			p.LastLogin = &t
		}
		out = append(out, p)
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

// updateUser changes what a user may do. A nil quota, or a nil
// canSharePublic, keeps what the user has. The last administrator cannot
// become a normal user, for the same reason it cannot be removed.
//
// A user who may no longer share in public (no permission and not an
// administrator) loses the public links they made, in the same
// transaction: those links stop working at once. revoked is how many.
func (s store) updateUser(ctx context.Context, id int64, role Role, canUpload bool, canSharePublic *bool, quota *int64) (_ Account, revoked int64, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Account{}, 0, fmt.Errorf("update user: %w", err)
	}
	defer func() { err = finish(tx, err) }()

	a := Account{ID: id, Role: role, CanUpload: canUpload}
	var old string
	err = tx.QueryRowContext(ctx, `SELECT name, role, can_share_public, upload_quota, coalesce(accent_color, ''), avatar, skip_seconds FROM users WHERE id = ?`, id).
		Scan(&a.Name, &old, &a.CanSharePublic, &a.UploadQuota, &a.AccentColor, &a.Avatar, &a.SkipSeconds)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, 0, errUserNotFound
	}
	if err != nil {
		return Account{}, 0, fmt.Errorf("update user: %w", err)
	}
	if Role(old) == Admin && role != Admin {
		var admins int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE role = 'admin'`).Scan(&admins); err != nil {
			return Account{}, 0, fmt.Errorf("update user: %w", err)
		}
		if admins <= 1 {
			return Account{}, 0, errLastAdmin
		}
	}
	if quota != nil {
		a.UploadQuota = *quota
	}
	if canSharePublic != nil {
		a.CanSharePublic = *canSharePublic
	}
	if _, err := tx.ExecContext(ctx, `UPDATE users SET role = ?, can_upload = ?, can_share_public = ?, upload_quota = ? WHERE id = ?`,
		string(role), canUpload, a.CanSharePublic, a.UploadQuota, id); err != nil {
		return Account{}, 0, fmt.Errorf("update user: %w", err)
	}
	if !a.MaySharePublic() {
		res, err := tx.ExecContext(ctx, `DELETE FROM public_links WHERE created_by = ?`, id)
		if err != nil {
			return Account{}, 0, fmt.Errorf("revoke public links: %w", err)
		}
		if revoked, err = res.RowsAffected(); err != nil {
			return Account{}, 0, fmt.Errorf("revoke public links: %w", err)
		}
	}
	return a, revoked, nil
}

// setPassword changes a password and closes every session of the user
// except keep (the browser that made the change), so a stolen session
// stops working. An empty keep closes them all.
func (s store) setPassword(ctx context.Context, id int64, hash string, keep []byte) (err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("set password: %w", err)
	}
	defer func() { err = finish(tx, err) }()
	res, err := tx.ExecContext(ctx, `UPDATE users SET password_hash = ? WHERE id = ?`, hash, id)
	if err != nil {
		return fmt.Errorf("set password: %w", err)
	}
	if n, err := res.RowsAffected(); err != nil {
		return fmt.Errorf("set password: %w", err)
	} else if n == 0 {
		return errUserNotFound
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ? AND token_hash != ?`, id, keep); err != nil {
		return fmt.Errorf("set password: %w", err)
	}
	return nil
}

// replaceHash swaps a password hash for an equivalent one (same password,
// better method). It changes nothing if the password changed meanwhile,
// and it keeps every session: the person is the same.
func (s store) replaceHash(ctx context.Context, id int64, old, hash string) error {
	if _, err := s.db.ExecContext(ctx, `UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?`, hash, id, old); err != nil {
		return fmt.Errorf("replace password hash: %w", err)
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
