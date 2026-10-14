package progress

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// errVideoNotFound means there is no present video with that id.
var errVideoNotFound = errors.New("video not found")

type store struct {
	db *sql.DB
}

// duration returns the length of a present video, 0 when not read yet.
func (s store) duration(ctx context.Context, videoID int64) (int64, error) {
	var d sql.NullInt64
	err := s.db.QueryRowContext(ctx, `SELECT duration FROM videos WHERE id = ? AND visible`, videoID).Scan(&d)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, errVideoNotFound
	}
	if err != nil {
		return 0, fmt.Errorf("read video %d: %w", videoID, err)
	}
	return d.Int64, nil
}

func (s store) save(ctx context.Context, userID, videoID int64, m Mark, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO watch_progress (user_id, video_id, position, finished, updated_at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (user_id, video_id) DO UPDATE SET
			position = excluded.position, finished = excluded.finished, updated_at = excluded.updated_at,
			in_continue = 1`,
		userID, videoID, m.Position, m.Finished, now.Unix())
	if err != nil {
		return fmt.Errorf("save progress: %w", err)
	}
	return nil
}

// get returns the mark of one video; the zero Mark when never watched.
func (s store) get(ctx context.Context, userID, videoID int64) (Mark, error) {
	var m Mark
	err := s.db.QueryRowContext(ctx, `SELECT position, finished FROM watch_progress WHERE user_id = ? AND video_id = ?`,
		userID, videoID).Scan(&m.Position, &m.Finished)
	if errors.Is(err, sql.ErrNoRows) {
		return Mark{}, nil
	}
	if err != nil {
		return Mark{}, fmt.Errorf("read progress: %w", err)
	}
	return m, nil
}

// watched is one video in someone's history.
type watched struct {
	videoID  int64
	position int64
	finished bool
	at       time.Time // the last time it was watched
}

// list returns the videos watched by a person, most recent first, and how
// many there are in all. Only present videos count. With onlyStarted,
// only those left in the middle: for "Continua a guardare".
func (s store) list(ctx context.Context, userID int64, onlyStarted bool, limit, offset int) (_ []watched, total int, err error) {
	where := `p.user_id = ? AND v.visible`
	if onlyStarted {
		where += ` AND p.finished = 0 AND p.position > 0 AND p.in_continue`
	}
	from := ` FROM watch_progress p JOIN videos v ON v.id = p.video_id WHERE ` + where
	if err := s.db.QueryRowContext(ctx, `SELECT count(*)`+from, userID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count progress: %w", err)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT p.video_id, p.position, p.finished, p.updated_at`+from+`
		ORDER BY p.updated_at DESC, p.video_id DESC LIMIT ? OFFSET ?`, userID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list progress: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	var out []watched
	for rows.Next() {
		var w watched
		var at int64
		if err := rows.Scan(&w.videoID, &w.position, &w.finished, &at); err != nil {
			return nil, 0, fmt.Errorf("list progress: %w", err)
		}
		w.at = time.Unix(at, 0).UTC()
		out = append(out, w)
	}
	return out, total, rows.Err()
}

// leaveContinue takes a video out of "Continua a guardare", keeping it in
// the history. It reports whether the video was there.
func (s store) leaveContinue(ctx context.Context, userID, videoID int64) (bool, error) {
	res, err := s.db.ExecContext(ctx, `UPDATE watch_progress SET in_continue = 0
		WHERE user_id = ? AND video_id = ? AND in_continue`, userID, videoID)
	if err != nil {
		return false, fmt.Errorf("leave continue: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("leave continue: %w", err)
	}
	return n > 0, nil
}

// forget removes one video from a person's history; with videoID 0, all
// of them. It reports how many were removed.
func (s store) forget(ctx context.Context, userID, videoID int64) (int64, error) {
	query, args := `DELETE FROM watch_progress WHERE user_id = ?`, []any{userID}
	if videoID != 0 {
		query += ` AND video_id = ?`
		args = append(args, videoID)
	}
	res, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, fmt.Errorf("forget progress: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("forget progress: %w", err)
	}
	return n, nil
}
