package users

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/respond"
)

// Wrong tries slow down whoever is guessing. They are counted twice: for
// the name that was tried and for the address the try came from, so that
// neither trying many names from one place nor one name from many places
// goes fast. After policy.threshold wrong tries the key is blocked, each
// block longer than the one before. The record lives in the database, so
// restarting FranzPLAY does not give anybody new tries.
type policy struct {
	threshold int
	steps     []time.Duration // the length of the 1st, 2nd… block; the last one repeats
}

var (
	// passwordPolicy is for accounts with a password: 5 wrong tries, then
	// 1 minute, 5, 15, an hour, 4 hours, a day.
	passwordPolicy = policy{threshold: 5, steps: []time.Duration{
		time.Minute, 5 * time.Minute, 15 * time.Minute, time.Hour, 4 * time.Hour, 24 * time.Hour,
	}}
	// secretPolicy is for a PIN or a pattern, much easier to guess: 3
	// wrong tries, and the first block is already 5 minutes.
	secretPolicy = policy{threshold: 3, steps: passwordPolicy.steps[1:]}
	// addressPolicy is for one address: more tries, because a whole family
	// can share it, with the same growing blocks.
	addressPolicy = policy{threshold: 20, steps: passwordPolicy.steps}
)

// policyFor is the policy of an account using method m.
func policyFor(m Method) policy {
	if m == Password {
		return passwordPolicy
	}
	return secretPolicy
}

// forgetAfter is how long without wrong tries before a key starts again
// from zero, its block lengths included.
const forgetAfter = 24 * time.Hour

// blockState is the record of wrong tries of one key.
type blockState struct {
	failures int
	level    int // blocks so far
	until    time.Time
	last     time.Time // last wrong try
}

// failed returns the record after one more wrong try. Pure: easy to test.
func (b blockState) failed(p policy, now time.Time) blockState {
	if now.Sub(b.last) > forgetAfter {
		b = blockState{}
	}
	b.failures++
	b.last = now
	if b.failures >= p.threshold {
		b.until = now.Add(p.steps[min(b.level, len(p.steps)-1)])
		b.level++
		b.failures = 0
	}
	return b
}

// wait is how long the key must still wait; 0 when it may try now.
func (b blockState) wait(now time.Time) time.Duration {
	return max(b.until.Sub(now), 0)
}

// blockKey and addressKey name the records.
func blockKey(name string) string {
	return "account:" + strings.ToLower(logName(strings.TrimSpace(name)))
}

func addressKey(address string) string { return "address:" + address }

// blockedError means a key is blocked; Wait says for how long.
type blockedError struct{ Wait time.Duration }

func (e blockedError) Error() string {
	return fmt.Sprintf("too many wrong tries: try again in %s", roundWait(e.Wait))
}

// Is lets errors.Is(err, errTooManyTries) find it.
func (e blockedError) Is(target error) bool { return target == errTooManyTries }

// roundWait rounds a wait up to whole seconds, at least one.
func roundWait(d time.Duration) time.Duration {
	return max(d.Round(time.Second), time.Second)
}

func (s store) readBlock(ctx context.Context, q queryer, key string) (blockState, error) {
	var b blockState
	var until, last int64
	err := q.QueryRowContext(ctx, `SELECT failures, level, blocked_until, last_failure FROM login_blocks WHERE key = ?`, key).
		Scan(&b.failures, &b.level, &until, &last)
	if errors.Is(err, sql.ErrNoRows) {
		return blockState{}, nil
	}
	if err != nil {
		return blockState{}, fmt.Errorf("read login block: %w", err)
	}
	b.until, b.last = time.Unix(until, 0), time.Unix(last, 0)
	return b, nil
}

// blockWait is the longest wait among keys: 0 when all may try now.
func (s store) blockWait(ctx context.Context, keys []string, now time.Time) (time.Duration, error) {
	var longest time.Duration
	for _, k := range keys {
		b, err := s.readBlock(ctx, s.db, k)
		if err != nil {
			return 0, err
		}
		longest = max(longest, b.wait(now))
	}
	return longest, nil
}

// recordFailure counts a wrong try for key and returns its new record.
// It also forgets records nobody needs any more.
func (s store) recordFailure(ctx context.Context, key string, p policy, now time.Time) (_ blockState, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return blockState{}, fmt.Errorf("record wrong try: %w", err)
	}
	defer func() { err = finish(tx, err) }()
	b, err := s.readBlock(ctx, tx, key)
	if err != nil {
		return blockState{}, err
	}
	b = b.failed(p, now)
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO login_blocks (key, failures, level, blocked_until, last_failure) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (key) DO UPDATE SET failures = excluded.failures, level = excluded.level,
			blocked_until = excluded.blocked_until, last_failure = excluded.last_failure`,
		key, b.failures, b.level, b.until.Unix(), b.last.Unix()); err != nil {
		return blockState{}, fmt.Errorf("record wrong try: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM login_blocks WHERE last_failure < ? AND blocked_until < ?`,
		now.Add(-forgetAfter).Unix(), now.Unix()); err != nil {
		return blockState{}, fmt.Errorf("record wrong try: %w", err)
	}
	return b, nil
}

// clearBlock forgets the wrong tries of a key, after a right one.
func (s store) clearBlock(ctx context.Context, key string) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM login_blocks WHERE key = ?`, key); err != nil {
		return fmt.Errorf("clear login block: %w", err)
	}
	return nil
}

// ClearBlocks forgets every block and every wrong try, of names and
// addresses, and returns how many it forgot. It is the way back in when
// someone keeps the only administrator blocked: "franzplay unblock".
func ClearBlocks(ctx context.Context, db *sql.DB) (int64, error) {
	res, err := db.ExecContext(ctx, `DELETE FROM login_blocks`)
	if err != nil {
		return 0, fmt.Errorf("clear login blocks: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("clear login blocks: %w", err)
	}
	return n, nil
}

// checkTries refuses a try when the account or the address is blocked.
func (s *Service) checkTries(ctx context.Context, keys ...string) error {
	wait, err := s.store.blockWait(ctx, keys, s.now())
	if err != nil {
		return err
	}
	if wait > 0 {
		return blockedError{Wait: wait}
	}
	return nil
}

// wrongTry counts a wrong try for the account (with the policy of its
// method) and, when given, for the address. When the try started a
// block, it returns that block as the error; otherwise errBadCredentials.
func (s *Service) wrongTry(ctx context.Context, account string, m Method, address string) error {
	now := s.now()
	b, err := s.store.recordFailure(ctx, account, policyFor(m), now)
	if err != nil {
		return err
	}
	wait := b.wait(now)
	if address != "" {
		ab, err := s.store.recordFailure(ctx, addressKey(address), addressPolicy, now)
		if err != nil {
			return err
		}
		wait = max(wait, ab.wait(now))
	}
	if wait > 0 {
		s.logger.WarnContext(ctx, "login blocked", "key", account, "address", address, "wait", roundWait(wait))
		return blockedError{Wait: wait}
	}
	return errBadCredentials
}

// Block is a name or an address that may not try to log in now, as the
// administrator sees it in the access page.
type Block struct {
	Key   string    `json:"key"`
	Kind  string    `json:"kind"`  // "account" or "address"
	Value string    `json:"value"` // the name (in lowercase) or the address
	Level int       `json:"level"` // how many blocks in a row
	Until time.Time `json:"until"`
}

func (s store) activeBlocks(ctx context.Context, now time.Time) (_ []Block, err error) {
	rows, err := s.db.QueryContext(ctx, `SELECT key, level, blocked_until FROM login_blocks WHERE blocked_until > ? ORDER BY blocked_until DESC`, now.Unix())
	if err != nil {
		return nil, fmt.Errorf("list login blocks: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := []Block{}
	for rows.Next() {
		var b Block
		var until int64
		if err := rows.Scan(&b.Key, &b.Level, &until); err != nil {
			return nil, fmt.Errorf("list login blocks: %w", err)
		}
		b.Kind, b.Value, _ = strings.Cut(b.Key, ":")
		b.Until = time.Unix(until, 0).UTC()
		out = append(out, b)
	}
	return out, rows.Err()
}

func (s *Service) handleBlocks(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.activeBlocks(r.Context(), s.now())
	if err != nil {
		s.fail(w, r, err)
		return
	}
	respond.JSON(w, r, s.logger, http.StatusOK, list)
}

type unblockRequest struct {
	Key string `json:"key"`
}

// handleUnblock lets the administrator lift a block at once, for someone
// who just mistyped too often.
func (s *Service) handleUnblock(w http.ResponseWriter, r *http.Request) {
	var req unblockRequest
	if err := readJSON(w, r, &req); err != nil || req.Key == "" {
		s.badRequest(w, r)
		return
	}
	if err := s.store.clearBlock(r.Context(), req.Key); err != nil {
		s.fail(w, r, err)
		return
	}
	admin, _ := FromContext(r.Context())
	s.logger.InfoContext(r.Context(), "login block lifted", "key", req.Key, "by", admin.Name)
	w.WriteHeader(http.StatusNoContent)
}

// SetTrustedProxies names the reverse proxies in front of FranzPLAY. Only
// requests coming from them may say, with X-Forwarded-For, which address
// the person really has; anybody else could write any address there to
// escape the blocks.
func (s *Service) SetTrustedProxies(proxies []netip.Prefix) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.trusted = proxies
}

// clientAddr is the address a request comes from: the connection's own,
// or, when that is a trusted proxy, the last address in X-Forwarded-For
// that is not a trusted proxy itself.
func (s *Service) clientAddr(r *http.Request) string {
	s.mu.Lock()
	trusted := s.trusted
	s.mu.Unlock()
	return realAddr(r, trusted)
}

// limitsAddress says whether wrong logins from this request may block its
// address. Not when the request comes through a reverse proxy at home (a
// private address) that is not among the trusted ones: then every person seems to come from the
// proxy's address, and twenty wrong tries by a stranger would lock the
// whole family out. The names stay protected by their own blocks.
func (s *Service) limitsAddress(r *http.Request) bool {
	if r.Header.Get("X-Forwarded-For") == "" {
		return true
	}
	s.mu.Lock()
	trusted := s.trusted
	s.mu.Unlock()
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil || isTrusted(peer, trusted) {
		return true
	}
	// A proxy sits at home or in the same computer: a public address that
	// writes X-Forwarded-For is someone trying to escape the blocks.
	if peer = peer.Unmap(); !peer.IsPrivate() && !peer.IsLoopback() && !peer.IsLinkLocalUnicast() {
		return true
	}
	s.proxyWarned.Do(func() {
		s.logger.WarnContext(r.Context(), "a reverse proxy that is not trusted sends X-Forwarded-For: "+
			"wrong logins block only names, not addresses; add the proxy to FRANZPLAY_TRUSTED_PROXIES",
			"proxy", host)
	})
	return false
}

func realAddr(r *http.Request, trusted []netip.Prefix) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil || !isTrusted(peer, trusted) {
		return host
	}
	var hops []string
	for _, h := range r.Header.Values("X-Forwarded-For") {
		hops = append(hops, strings.Split(h, ",")...)
	}
	addr := peer
	// From the right: each hop was added by the one after it.
	for i := len(hops) - 1; i >= 0; i-- {
		ip, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			break
		}
		addr = ip.Unmap()
		if !isTrusted(addr, trusted) {
			break
		}
	}
	return addr.String()
}

func isTrusted(ip netip.Addr, trusted []netip.Prefix) bool {
	ip = ip.Unmap()
	for _, p := range trusted {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}
