package users

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"time"
)

// A session lasts sessionLife after the last time it was used: someone who
// watches FranzPLAY at least once a month never has to log in again.
const sessionLife = 30 * 24 * time.Hour

// touchEvery limits how often a session's last use is written down, so
// that watching a video does not write to the database at every request.
const touchEvery = time.Hour

// errNoSession means the cookie does not match a valid session.
var errNoSession = errors.New("no valid session")

// newToken returns a random session token for the cookie and the hash of
// it kept in the database.
func newToken() (token string, hash []byte, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", nil, fmt.Errorf("new session: %w", err)
	}
	token = base64.RawURLEncoding.EncodeToString(b)
	return token, hashToken(token), nil
}

func hashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// needsTouch decides whether a session in use should get a new expiry.
func needsTouch(lastSeen, now time.Time) bool {
	return now.Sub(lastSeen) >= touchEvery
}

func (s store) createSession(ctx context.Context, userID int64, hash []byte, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO sessions (token_hash, user_id, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?)`,
		hash, userID, now.Unix(), now.Unix(), now.Add(sessionLife).Unix())
	if err != nil {
		return fmt.Errorf("create session: %w", err)
	}
	return nil
}

// sessionAccount returns the user of a valid session and keeps the session
// alive.
func (s store) sessionAccount(ctx context.Context, hash []byte, now time.Time) (Account, error) {
	var a Account
	var role string
	var lastSeen int64
	err := s.db.QueryRowContext(ctx, `
		SELECT u.id, u.name, u.role, u.can_upload, u.upload_quota, coalesce(u.accent_color, ''), u.avatar, s.last_seen
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ? AND s.expires_at > ?`, hash, now.Unix()).
		Scan(&a.ID, &a.Name, &role, &a.CanUpload, &a.UploadQuota, &a.AccentColor, &a.Avatar, &lastSeen)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, errNoSession
	}
	if err != nil {
		return Account{}, fmt.Errorf("read session: %w", err)
	}
	r, ok := parseRole(role)
	if !ok {
		return Account{}, fmt.Errorf("user %d has unknown role %q", a.ID, role)
	}
	a.Role = r
	if needsTouch(time.Unix(lastSeen, 0), now) {
		if _, err := s.db.ExecContext(ctx, `UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?`,
			now.Unix(), now.Add(sessionLife).Unix(), hash); err != nil {
			return Account{}, fmt.Errorf("touch session: %w", err)
		}
	}
	return a, nil
}

func (s store) deleteSession(ctx context.Context, hash []byte) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, hash); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}

// deleteExpiredSessions cleans up sessions nobody used for a long time.
func (s store) deleteExpiredSessions(ctx context.Context, now time.Time) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE expires_at <= ?`, now.Unix()); err != nil {
		return fmt.Errorf("delete expired sessions: %w", err)
	}
	return nil
}
