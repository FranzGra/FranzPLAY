package users

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/FranzGra/FranzPLAY/internal/respond"
)

// Outcome is how a try to log in ended. The list is closed.
type Outcome string

// The outcomes.
const (
	Entered       Outcome = "entered"        // right name and password
	WrongPassword Outcome = "wrong_password" // wrong password, or a name that does not exist
	Locked        Outcome = "locked"         // too many wrong passwords: not even checked
)

// The access log keeps what is useful to see who entered and to spot
// someone guessing passwords, without growing forever.
const (
	logLife      = 90 * 24 * time.Hour
	maxLogRows   = 10000
	maxLogName   = 64  // longer typed names are cut
	logPage      = 100 // entries per page
	maxLogSearch = 64
)

// Login is one entry of the access log.
type Login struct {
	ID      int64     `json:"id"`
	At      time.Time `json:"at"`
	Name    string    `json:"name"`
	Address string    `json:"address"`
	Outcome Outcome   `json:"outcome"`
}

// logName is the typed name as it is kept: cut, and valid text.
func logName(name string) string {
	name = strings.ToValidUTF8(name, "�")
	if utf8.RuneCountInString(name) > maxLogName {
		name = string([]rune(name)[:maxLogName])
	}
	return name
}

// recordLogin writes a try to log in, and forgets the oldest ones. userID
// is 0 when the name is nobody's. On success it also remembers when the
// user last entered.
func (s store) recordLogin(ctx context.Context, now time.Time, name string, userID int64, address string, outcome Outcome) (err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("record login: %w", err)
	}
	defer func() { err = finish(tx, err) }()

	var user any
	if userID != 0 {
		user = userID
	}
	res, err := tx.ExecContext(ctx, `INSERT INTO logins (at, name, user_id, address, outcome) VALUES (?, ?, ?, ?, ?)`,
		now.Unix(), logName(name), user, address, string(outcome))
	if err != nil {
		return fmt.Errorf("record login: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("record login: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM logins WHERE at < ? OR id <= ?`,
		now.Add(-logLife).Unix(), id-maxLogRows); err != nil {
		return fmt.Errorf("record login: %w", err)
	}
	if outcome == Entered {
		if _, err := tx.ExecContext(ctx, `UPDATE users SET last_login = ? WHERE id = ?`, now.Unix(), userID); err != nil {
			return fmt.Errorf("record login: %w", err)
		}
	}
	return nil
}

// loginFilter chooses which entries of the access log to show.
type loginFilter struct {
	search     string // part of the name or of the address; "" for all
	onlyFailed bool   // only wrong passwords and locked names
	before     int64  // only entries older than this id; 0 for the newest
}

// likePattern turns words typed in a search into a LIKE pattern that
// finds them as they are: % and _ typed by people are not wildcards.
func likePattern(search string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(search) + "%"
}

// listLogins returns a page of the access log, the newest first, and
// whether there are older entries.
func (s store) listLogins(ctx context.Context, f loginFilter) (_ []Login, more bool, err error) {
	query := `SELECT id, at, name, address, outcome FROM logins WHERE 1 = 1`
	var args []any
	if f.search != "" {
		query += ` AND (name LIKE ? ESCAPE '\' OR address LIKE ? ESCAPE '\')`
		p := likePattern(f.search)
		args = append(args, p, p)
	}
	if f.onlyFailed {
		query += ` AND outcome != 'entered'`
	}
	if f.before > 0 {
		query += ` AND id < ?`
		args = append(args, f.before)
	}
	query += ` ORDER BY id DESC LIMIT ?`
	args = append(args, logPage+1)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, false, fmt.Errorf("list logins: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := []Login{}
	for rows.Next() {
		var l Login
		var at int64
		var outcome string
		if err := rows.Scan(&l.ID, &at, &l.Name, &l.Address, &outcome); err != nil {
			return nil, false, fmt.Errorf("list logins: %w", err)
		}
		l.At = time.Unix(at, 0).UTC()
		l.Outcome = Outcome(outcome)
		out = append(out, l)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("list logins: %w", err)
	}
	if len(out) > logPage {
		return out[:logPage], true, nil
	}
	return out, false, nil
}

// loginPage is the answer of GET /api/logins.
type loginPage struct {
	Logins []Login `json:"logins"`
	More   bool    `json:"more"` // older entries exist: ask again with before
}

func (s *Service) handleLogins(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	f := loginFilter{search: strings.TrimSpace(q.Get("q")), onlyFailed: q.Get("failed") == "1"}
	if utf8.RuneCountInString(f.search) > maxLogSearch {
		respond.Error(w, r, s.logger, http.StatusBadRequest, "the search is too long")
		return
	}
	if b := q.Get("before"); b != "" {
		id, err := strconv.ParseInt(b, 10, 64)
		if err != nil || id <= 0 {
			respond.Error(w, r, s.logger, http.StatusBadRequest, "before must be the id of an entry")
			return
		}
		f.before = id
	}
	list, more, err := s.store.listLogins(r.Context(), f)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	respond.JSON(w, r, s.logger, http.StatusOK, loginPage{Logins: list, More: more})
}
