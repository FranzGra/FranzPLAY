package uploads

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
)

// upload is a video on its way from a browser, as the API shows it.
type upload struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Title    string `json:"title"`
	Size     int64  `json:"size"`
	Received int64  `json:"received"`
	// Video is the new video, once the last piece has arrived.
	Video int64 `json:"video,omitempty"`

	user int64
}

// store reads and writes the uploads table, and the catalog row of a
// finished upload.
type store struct {
	db *sql.DB
}

// space returns how a person's quota is used and how many uploads they
// have not finished.
func (s store) space(ctx context.Context, q queryer, user, quota int64) (Space, int, error) {
	sp := Space{Quota: quota}
	var waiting int
	err := q.QueryRowContext(ctx, `
		SELECT (SELECT coalesce(sum(size), 0) FROM videos WHERE uploaded_by = ?1),
		       (SELECT coalesce(sum(size), 0) FROM uploads WHERE user_id = ?1),
		       (SELECT count(*) FROM uploads WHERE user_id = ?1)`, user).
		Scan(&sp.Used, &sp.Reserved, &waiting)
	if err != nil {
		return Space{}, 0, fmt.Errorf("read space of user %d: %w", user, err)
	}
	return sp, waiting, nil
}

// queryer is what space needs: the database or a transaction.
type queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// start adds an upload if decide, the core, accepts it given the person's
// space. Reading the space and adding the row happen in one transaction
// that holds the database from its first statement, so two uploads started
// at the same moment can never take more than the quota together.
func (s store) start(ctx context.Context, user, quota int64, now time.Time,
	decide func(Space, int) (newUpload, error),
) (_ upload, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return upload{}, fmt.Errorf("start upload: %w", err)
	}
	defer func() { err = finishTx(tx, err) }()

	// A write as the first statement makes this transaction the only writer
	// at once, instead of failing later if another one wrote in between.
	if _, err := tx.ExecContext(ctx, `UPDATE users SET id = id WHERE id = ?`, user); err != nil {
		return upload{}, fmt.Errorf("start upload: %w", err)
	}
	sp, waiting, err := s.space(ctx, tx, user, quota)
	if err != nil {
		return upload{}, err
	}
	clean, err := decide(sp, waiting)
	if err != nil {
		return upload{}, err
	}
	res, err := tx.ExecContext(ctx, `
		INSERT INTO uploads (user_id, name, title, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
		user, clean.Name, clean.Title, clean.Size, now.Unix(), now.Unix())
	if err != nil {
		return upload{}, fmt.Errorf("start upload: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return upload{}, fmt.Errorf("start upload: %w", err)
	}
	return upload{ID: id, Name: clean.Name, Title: clean.Title, Size: clean.Size, user: user}, nil
}

// get returns an upload of a person. Someone else's is not found.
func (s store) get(ctx context.Context, user, id int64) (upload, error) {
	u := upload{ID: id, user: user}
	err := s.db.QueryRowContext(ctx, `SELECT name, title, size, received FROM uploads WHERE id = ? AND user_id = ?`,
		id, user).Scan(&u.Name, &u.Title, &u.Size, &u.Received)
	if errors.Is(err, sql.ErrNoRows) {
		return upload{}, errNotFound
	}
	if err != nil {
		return upload{}, fmt.Errorf("read upload %d: %w", id, err)
	}
	return u, nil
}

// mine returns the unfinished uploads of a person, the oldest first.
func (s store) mine(ctx context.Context, user int64) (_ []upload, err error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, title, size, received FROM uploads WHERE user_id = ? ORDER BY id`, user)
	if err != nil {
		return nil, fmt.Errorf("list uploads: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := []upload{}
	for rows.Next() {
		u := upload{user: user}
		if err := rows.Scan(&u.ID, &u.Name, &u.Title, &u.Size, &u.Received); err != nil {
			return nil, fmt.Errorf("list uploads: %w", err)
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// arrived records that an upload now has received bytes.
func (s store) arrived(ctx context.Context, id, received int64, now time.Time) error {
	if _, err := s.db.ExecContext(ctx, `UPDATE uploads SET received = ?, updated_at = ? WHERE id = ?`,
		received, now.Unix(), id); err != nil {
		return fmt.Errorf("save upload %d: %w", id, err)
	}
	return nil
}

// remove forgets an upload.
func (s store) remove(ctx context.Context, id int64) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM uploads WHERE id = ?`, id); err != nil {
		return fmt.Errorf("remove upload %d: %w", id, err)
	}
	return nil
}

// ids returns every upload, finished or not yet.
func (s store) ids(ctx context.Context) (_ map[int64]bool, err error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM uploads`)
	if err != nil {
		return nil, fmt.Errorf("list uploads: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := map[int64]bool{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("list uploads: %w", err)
		}
		out[id] = true
	}
	return out, rows.Err()
}

// stale returns the uploads that received nothing since before.
func (s store) stale(ctx context.Context, before time.Time) (_ []int64, err error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM uploads WHERE updated_at < ?`, before.Unix())
	if err != nil {
		return nil, fmt.Errorf("list old uploads: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("list old uploads: %w", err)
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// finished is a complete file, ready to become a video.
type finished struct {
	upload      upload
	fingerprint string
	library     string // the uploads folder, as the scanner knows it
	path        string // inside the uploads folder, with "/"
	modTime     int64  // Unix nanoseconds, as the scanner reads it
}

// finish turns a complete upload into a video, all in one transaction:
// the catalog row, the first job and the end of the upload. place puts the
// file where the row says, before the transaction is saved; if saving
// fails, the caller puts it back. A video already in the catalog is
// refused with errDuplicate, and nothing changes.
func (s store) finish(ctx context.Context, f finished, now time.Time, place func() error) (_ int64, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("finish upload: %w", err)
	}
	defer func() { err = finishTx(tx, err) }()

	// Write first, so this transaction holds the database from the start.
	if _, err := tx.ExecContext(ctx, `INSERT INTO libraries (path) VALUES (?) ON CONFLICT (path) DO NOTHING`,
		f.library); err != nil {
		return 0, fmt.Errorf("finish upload: %w", err)
	}
	var library int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM libraries WHERE path = ?`, f.library).Scan(&library); err != nil {
		return 0, fmt.Errorf("finish upload: %w", err)
	}
	var existing int64
	err = tx.QueryRowContext(ctx, `SELECT id FROM videos WHERE fingerprint = ?`, f.fingerprint).Scan(&existing)
	switch {
	case err == nil:
		return 0, errDuplicate
	case !errors.Is(err, sql.ErrNoRows):
		return 0, fmt.Errorf("finish upload: %w", err)
	}
	u := f.upload
	res, err := tx.ExecContext(ctx, `
		INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, category, added_at, uploaded_by)
		VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)`,
		f.fingerprint, library, f.path, u.Size, f.modTime, u.Title, now.Unix(), u.user)
	if err != nil {
		return 0, fmt.Errorf("finish upload: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("finish upload: %w", err)
	}
	// Reading the file starts everything else: cover, previews, the copy
	// for the browsers when one is needed.
	if err := jobs.Enqueue(ctx, tx, id, jobs.Probe, false, now); err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM uploads WHERE id = ?`, u.ID); err != nil {
		return 0, fmt.Errorf("finish upload: %w", err)
	}
	if err := place(); err != nil {
		return 0, err
	}
	return id, nil
}

// finishTx commits the transaction when err is nil, and rolls it back otherwise.
func finishTx(tx *sql.Tx, err error) error {
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
