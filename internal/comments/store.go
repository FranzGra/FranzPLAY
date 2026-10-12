package comments

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// Store errors.
var (
	errVideoNotFound   = errors.New("video not found")
	errCommentNotFound = errors.New("comment not found")
)

// maxPerVideo is how many comments of a video are shown at most: far more
// than a family writes, few enough to stay light on a Raspberry Pi.
const maxPerVideo = 1000

// row is a comment as stored.
type row struct {
	id, videoID, userID int64
	parentID            int64 // 0 = not a reply
	author              string
	body                string
	createdAt           time.Time
}

type store struct {
	db *sql.DB
}

// present checks that a video exists and is not missing.
func (s store) present(ctx context.Context, videoID int64) error {
	var one int
	err := s.db.QueryRowContext(ctx, `SELECT 1 FROM videos WHERE id = ? AND missing_since IS NULL`, videoID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return errVideoNotFound
	}
	if err != nil {
		return fmt.Errorf("read video %d: %w", videoID, err)
	}
	return nil
}

const selectRow = `SELECT c.id, c.video_id, c.user_id, coalesce(c.parent_id, 0), u.name, c.body, c.created_at
	FROM comments c JOIN users u ON u.id = c.user_id`

func scanRow(sc interface{ Scan(...any) error }) (row, error) {
	var r row
	var created int64
	if err := sc.Scan(&r.id, &r.videoID, &r.userID, &r.parentID, &r.author, &r.body, &created); err != nil {
		return row{}, err
	}
	r.createdAt = time.Unix(created, 0).UTC()
	return r, nil
}

// list returns the comments of a video, oldest first.
func (s store) list(ctx context.Context, videoID int64) (_ []row, err error) {
	rows, err := s.db.QueryContext(ctx, selectRow+` WHERE c.video_id = ? ORDER BY c.created_at, c.id LIMIT ?`,
		videoID, maxPerVideo)
	if err != nil {
		return nil, fmt.Errorf("list comments: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	var out []row
	for rows.Next() {
		r, err := scanRow(rows)
		if err != nil {
			return nil, fmt.Errorf("list comments: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s store) get(ctx context.Context, id int64) (row, error) {
	r, err := scanRow(s.db.QueryRowContext(ctx, selectRow+` WHERE c.id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return row{}, errCommentNotFound
	}
	if err != nil {
		return row{}, fmt.Errorf("read comment %d: %w", id, err)
	}
	return r, nil
}

// add saves a new comment and returns it.
func (s store) add(ctx context.Context, videoID, userID, parentID int64, body string, now time.Time) (row, error) {
	var parent any
	if parentID != 0 {
		parent = parentID
	}
	res, err := s.db.ExecContext(ctx, `INSERT INTO comments (video_id, user_id, parent_id, body, created_at)
		VALUES (?, ?, ?, ?, ?)`, videoID, userID, parent, body, now.Unix())
	if err != nil {
		return row{}, fmt.Errorf("save comment: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return row{}, fmt.Errorf("save comment: %w", err)
	}
	return s.get(ctx, id)
}

// remove deletes a comment and its replies.
func (s store) remove(ctx context.Context, id int64) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM comments WHERE id = ?`, id); err != nil {
		return fmt.Errorf("delete comment %d: %w", id, err)
	}
	return nil
}
