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
	// LoginMethod is how the user logs in: password, PIN or pattern.
	LoginMethod Method `json:"loginMethod"`
	// AllowedMethods are the methods the user may choose now.
	AllowedMethods Methods `json:"allowedMethods"`
	// OwnMethods is the administrator's narrowing for this user; nil when
	// the user follows the server's choice.
	OwnMethods Methods `json:"ownMethods"`
	// MustChooseMethod says the administrator no longer allows the user's
	// method: it still opens the door once, then the user must pick an
	// allowed one before doing anything else.
	MustChooseMethod bool `json:"mustChooseMethod"`
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
	if a.LoginMethod == "" {
		a.LoginMethod = Password
	}
	var own any // NULL: the user follows the server
	if len(a.OwnMethods) > 0 {
		own = a.OwnMethods.String()
	}
	res, err := tx.ExecContext(ctx, `
		INSERT INTO users (name, password_hash, login_method, allowed_methods, role, can_upload, upload_quota, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		a.Name, hash, string(a.LoginMethod), own, string(a.Role), a.CanUpload, a.UploadQuota, now.Unix())
	if err != nil {
		return Account{}, fmt.Errorf("create user: %w", err)
	}
	if a.ID, err = res.LastInsertId(); err != nil {
		return Account{}, fmt.Errorf("create user: %w", err)
	}
	return a, nil
}

// accountColumns are the columns read by scanAccount, from users.
const accountColumns = `id, name, role, can_upload, can_share_public, upload_quota, coalesce(accent_color, ''), avatar, skip_seconds, login_method, coalesce(allowed_methods, '')`

// storedAccount is a user as read from the database, with its method
// columns still as text: Service.withMethods completes it.
type storedAccount struct {
	Account
	method, own string
}

type scanner interface{ Scan(dest ...any) error }

func scanAccount(row scanner, extra ...any) (storedAccount, error) {
	var a storedAccount
	var role string
	dest := append([]any{&a.ID, &a.Name, &role, &a.CanUpload, &a.CanSharePublic, &a.UploadQuota, &a.AccentColor, &a.Avatar, &a.SkipSeconds, &a.method, &a.own}, extra...)
	if err := row.Scan(dest...); err != nil {
		return storedAccount{}, err
	}
	r, ok := parseRole(role)
	if !ok {
		return storedAccount{}, fmt.Errorf("user %d has unknown role %q", a.ID, role)
	}
	a.Role = r
	return a, nil
}

// credentials returns a user and its password hash, by name.
func (s store) credentials(ctx context.Context, name string) (storedAccount, string, error) {
	var hash string
	a, err := scanAccount(s.db.QueryRowContext(ctx, `SELECT `+accountColumns+`, password_hash FROM users WHERE name = ?`, name), &hash)
	if errors.Is(err, sql.ErrNoRows) {
		return storedAccount{}, "", errUserNotFound
	}
	if err != nil {
		return storedAccount{}, "", fmt.Errorf("read user: %w", err)
	}
	return a, hash, nil
}

// byID returns a user and its hash, by id.
func (s store) byID(ctx context.Context, id int64) (storedAccount, string, error) {
	var hash string
	a, err := scanAccount(s.db.QueryRowContext(ctx, `SELECT `+accountColumns+`, password_hash FROM users WHERE id = ?`, id), &hash)
	if errors.Is(err, sql.ErrNoRows) {
		return storedAccount{}, "", errUserNotFound
	}
	if err != nil {
		return storedAccount{}, "", fmt.Errorf("read user: %w", err)
	}
	return a, hash, nil
}

// Person is a user as the administrator sees them in the list of people.
type Person struct {
	Account
	LastLogin *time.Time `json:"lastLogin"` // nil if they never logged in with name and password
}

// storedPerson is a Person whose methods are still text.
type storedPerson struct {
	storedAccount
	LastLogin *time.Time
}

func (s store) list(ctx context.Context) (_ []storedPerson, err error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+accountColumns+`, last_login FROM users ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := []storedPerson{}
	for rows.Next() {
		var p storedPerson
		var last sql.NullInt64
		a, err := scanAccount(rows, &last)
		if err != nil {
			return nil, fmt.Errorf("list users: %w", err)
		}
		p.storedAccount = a
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
func (s store) updateUser(ctx context.Context, id int64, role Role, canUpload bool, canSharePublic *bool, quota *int64, own *Methods) (_ storedAccount, revoked int64, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return storedAccount{}, 0, fmt.Errorf("update user: %w", err)
	}
	defer func() { err = finish(tx, err) }()

	a, err := scanAccount(tx.QueryRowContext(ctx, `SELECT `+accountColumns+` FROM users WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return storedAccount{}, 0, errUserNotFound
	}
	if err != nil {
		return storedAccount{}, 0, fmt.Errorf("update user: %w", err)
	}
	old := a.Role
	a.Role, a.CanUpload = role, canUpload
	if old == Admin && role != Admin {
		var admins int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE role = 'admin'`).Scan(&admins); err != nil {
			return storedAccount{}, 0, fmt.Errorf("update user: %w", err)
		}
		if admins <= 1 {
			return storedAccount{}, 0, errLastAdmin
		}
	}
	if quota != nil {
		a.UploadQuota = *quota
	}
	if canSharePublic != nil {
		a.CanSharePublic = *canSharePublic
	}
	if own != nil {
		a.own = own.String()
	}
	var ownValue any // NULL: the user follows the server
	if a.own != "" {
		ownValue = a.own
	}
	if _, err := tx.ExecContext(ctx, `UPDATE users SET role = ?, can_upload = ?, can_share_public = ?, upload_quota = ?, allowed_methods = ? WHERE id = ?`,
		string(role), canUpload, a.CanSharePublic, a.UploadQuota, ownValue, id); err != nil {
		return storedAccount{}, 0, fmt.Errorf("update user: %w", err)
	}
	if !a.MaySharePublic() {
		res, err := tx.ExecContext(ctx, `DELETE FROM public_links WHERE created_by = ?`, id)
		if err != nil {
			return storedAccount{}, 0, fmt.Errorf("revoke public links: %w", err)
		}
		if revoked, err = res.RowsAffected(); err != nil {
			return storedAccount{}, 0, fmt.Errorf("revoke public links: %w", err)
		}
	}
	return a, revoked, nil
}

// setPassword changes a password (or PIN, or pattern: m says which) and
// closes every session of the user except keep (the browser that made the
// change), so a stolen session stops working. An empty keep closes them all.
func (s store) setPassword(ctx context.Context, id int64, m Method, hash string, keep []byte) (err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("set password: %w", err)
	}
	defer func() { err = finish(tx, err) }()
	res, err := tx.ExecContext(ctx, `UPDATE users SET password_hash = ?, login_method = ? WHERE id = ?`, hash, string(m), id)
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
