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
	err := s.db.QueryRowContext(ctx, `SELECT duration FROM videos WHERE id = ? AND missing_since IS NULL`, videoID).Scan(&d)
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
			position = excluded.position, finished = excluded.finished, updated_at = excluded.updated_at`,
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

// started is a video someone is in the middle of.
type started struct {
	videoID  int64
	position int64
}

// inProgress returns the videos started and not finished, most recent first.
func (s store) inProgress(ctx context.Context, userID int64, limit int) (_ []started, err error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT p.video_id, p.position FROM watch_progress p JOIN videos v ON v.id = p.video_id
		WHERE p.user_id = ? AND p.finished = 0 AND p.position > 0 AND v.missing_since IS NULL
		ORDER BY p.updated_at DESC, p.video_id DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list progress: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	var out []started
	for rows.Next() {
		var st started
		if err := rows.Scan(&st.videoID, &st.position); err != nil {
			return nil, fmt.Errorf("list progress: %w", err)
		}
		out = append(out, st)
	}
	return out, rows.Err()
}
