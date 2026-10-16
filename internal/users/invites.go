package users

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// inviteLife is how long an invite link works: enough to send it and for
// the other person to find a moment, not so long that a forgotten link
// lies around.
const inviteLife = 7 * 24 * time.Hour

// maxNote is the longest note on an invite.
const maxNote = 60

// Invite errors shown to people.
var (
	errBadNote       = errors.New("the note must be one line of at most 60 characters")
	errInviteInvalid = errors.New("this invite does not work any more: it was already used, removed or it expired")
	errInviteMissing = errors.New("invite not found")
)

// InviteStatus says where an invite is. The list is closed.
type InviteStatus string

// The invite statuses.
const (
	InviteWaiting InviteStatus = "waiting" // nobody used it yet, and it still works
	InviteUsed    InviteStatus = "used"    // someone joined with it
	InviteExpired InviteStatus = "expired" // nobody used it in time
)

// Invite is an invite as administrators see it. The link itself is shown
// only once, when the invite is made: FranzPLAY keeps just its hash.
type Invite struct {
	ID        int64        `json:"id"`
	Note      string       `json:"note"`
	CanUpload bool         `json:"canUpload"`
	CreatedBy string       `json:"createdBy"` // "" if that administrator was removed
	CreatedAt time.Time    `json:"createdAt"`
	ExpiresAt time.Time    `json:"expiresAt"`
	Status    InviteStatus `json:"status"`
	UsedBy    string       `json:"usedBy"` // who joined with it; "" if not used or removed
}

// inviteStatus decides where an invite is.
func inviteStatus(used bool, expiresAt, now time.Time) InviteStatus {
	switch {
	case used:
		return InviteUsed
	case !now.Before(expiresAt):
		return InviteExpired
	default:
		return InviteWaiting
	}
}

// cleanNote checks the note of an invite and removes spaces around it.
func cleanNote(note string) (string, error) {
	note = strings.TrimSpace(note)
	if utf8.RuneCountInString(note) > maxNote || !utf8.ValidString(note) {
		return "", errBadNote
	}
	for _, r := range note {
		if unicode.IsControl(r) {
			return "", errBadNote
		}
	}
	return note, nil
}

// createInvite makes an invite and returns it with the code for its link.
func (s *Service) createInvite(ctx context.Context, admin Account, note string, canUpload bool) (Invite, string, error) {
	note, err := cleanNote(note)
	if err != nil {
		return Invite{}, "", err
	}
	token, hash, err := newToken()
	if err != nil {
		return Invite{}, "", err
	}
	now := time.Unix(s.now().Unix(), 0).UTC() // whole seconds, as the database keeps them
	inv := Invite{Note: note, CanUpload: canUpload, CreatedBy: admin.Name,
		CreatedAt: now, ExpiresAt: now.Add(inviteLife), Status: InviteWaiting}
	if inv.ID, err = s.store.createInvite(ctx, inv, admin.ID, hash); err != nil {
		return Invite{}, "", err
	}
	return inv, token, nil
}

// checkInvite tells whether the code of a link still works.
func (s *Service) checkInvite(ctx context.Context, token string) error {
	if len(token) > 100 {
		return errInviteInvalid
	}
	_, err := s.store.waitingInvite(ctx, s.store.db, hashToken(token), s.now())
	return err
}

// join creates the account of someone who opened an invite link. The
// invite is checked before the password is hashed, so made-up codes cost
// nothing; then checked again, used and the account created all at once,
// so one link never makes two accounts.
func (s *Service) join(ctx context.Context, token, name string, method Method, password string) (Account, error) {
	if len(token) > 100 {
		return Account{}, errInviteInvalid
	}
	hash := hashToken(token)
	if _, err := s.store.waitingInvite(ctx, s.store.db, hash, s.now()); err != nil {
		return Account{}, err
	}
	clean, err := CleanName(name)
	if err != nil {
		return Account{}, err
	}
	if method == "" {
		method = Password
	}
	if err := s.checkFirstSecret(ctx, method, password); err != nil {
		return Account{}, err
	}
	passwordHash, err := s.hash(ctx, password)
	if err != nil {
		return Account{}, err
	}
	a, err := s.store.joinWithInvite(ctx, hash, clean, method, passwordHash, s.now())
	if err != nil {
		return Account{}, err
	}
	return s.withMethods(ctx, a, string(method), "")
}

// queryer is what both the database and a transaction can do.
type queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func (s store) createInvite(ctx context.Context, inv Invite, adminID int64, hash []byte) (int64, error) {
	res, err := s.db.ExecContext(ctx, `
		INSERT INTO invites (token_hash, note, can_upload, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
		hash, inv.Note, inv.CanUpload, adminID, inv.CreatedAt.Unix(), inv.ExpiresAt.Unix())
	if err != nil {
		return 0, fmt.Errorf("create invite: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("create invite: %w", err)
	}
	return id, nil
}

// waitingInvite finds an invite that still works and says whether it lets
// the new person upload videos.
func (s store) waitingInvite(ctx context.Context, q queryer, hash []byte, now time.Time) (canUpload bool, err error) {
	err = q.QueryRowContext(ctx, `SELECT can_upload FROM invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,
		hash, now.Unix()).Scan(&canUpload)
	if errors.Is(err, sql.ErrNoRows) {
		return false, errInviteInvalid
	}
	if err != nil {
		return false, fmt.Errorf("read invite: %w", err)
	}
	return canUpload, nil
}

// joinWithInvite uses an invite and creates its account, in one transaction.
func (s store) joinWithInvite(ctx context.Context, hash []byte, name string, method Method, passwordHash string, now time.Time) (_ Account, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Account{}, fmt.Errorf("join: %w", err)
	}
	defer func() { err = finish(tx, err) }()

	canUpload, err := s.waitingInvite(ctx, tx, hash, now)
	if err != nil {
		return Account{}, err
	}
	a, err := insertUser(ctx, tx, Account{Name: name, Role: User, CanUpload: canUpload, LoginMethod: method}, passwordHash, now)
	if err != nil {
		return Account{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE invites SET used_by = ?, used_at = ? WHERE token_hash = ?`,
		a.ID, now.Unix(), hash); err != nil {
		return Account{}, fmt.Errorf("join: %w", err)
	}
	return a, nil
}

// listInvites returns every invite, the newest first.
func (s store) listInvites(ctx context.Context, now time.Time) (_ []Invite, err error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT i.id, i.note, i.can_upload, coalesce(c.name, ''), i.created_at, i.expires_at,
		       i.used_at IS NOT NULL, coalesce(u.name, '')
		FROM invites i
		LEFT JOIN users c ON c.id = i.created_by
		LEFT JOIN users u ON u.id = i.used_by
		ORDER BY i.created_at DESC, i.id DESC`)
	if err != nil {
		return nil, fmt.Errorf("list invites: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := []Invite{}
	for rows.Next() {
		var inv Invite
		var created, expires int64
		var used bool
		if err := rows.Scan(&inv.ID, &inv.Note, &inv.CanUpload, &inv.CreatedBy, &created, &expires, &used, &inv.UsedBy); err != nil {
			return nil, fmt.Errorf("list invites: %w", err)
		}
		inv.CreatedAt = time.Unix(created, 0).UTC()
		inv.ExpiresAt = time.Unix(expires, 0).UTC()
		inv.Status = inviteStatus(used, inv.ExpiresAt, now)
		out = append(out, inv)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list invites: %w", err)
	}
	return out, nil
}

// deleteInvite removes an invite: its link stops working at once.
func (s store) deleteInvite(ctx context.Context, id int64) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM invites WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete invite: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete invite: %w", err)
	}
	if n == 0 {
		return errInviteMissing
	}
	return nil
}
