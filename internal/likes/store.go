// Package likes lets each person like the videos they enjoy and shows how
// many people like a video. There is no "dislike" (decision F).
package likes

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// errVideoNotFound means there is no present video with that id.
var errVideoNotFound = errors.New("video not found")

// Like is what a person sees under a video.
type Like struct {
	Liked bool  `json:"liked"` // the person likes it
	Count int64 `json:"count"` // how many people like it
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

func (s store) get(ctx context.Context, userID, videoID int64) (Like, error) {
	var l Like
	err := s.db.QueryRowContext(ctx, `SELECT
		EXISTS (SELECT 1 FROM likes WHERE user_id = ? AND video_id = ?),
		(SELECT count(*) FROM likes WHERE video_id = ?)`, userID, videoID, videoID).Scan(&l.Liked, &l.Count)
	if err != nil {
		return Like{}, fmt.Errorf("read like: %w", err)
	}
	return l, nil
}

// set adds or removes the like of a person. Doing it twice changes
// nothing: a double click cannot count twice.
func (s store) set(ctx context.Context, userID, videoID int64, liked bool, now time.Time) error {
	var err error
	if liked {
		_, err = s.db.ExecContext(ctx, `INSERT INTO likes (user_id, video_id, created_at) VALUES (?, ?, ?)
			ON CONFLICT (user_id, video_id) DO NOTHING`, userID, videoID, now.Unix())
	} else {
		_, err = s.db.ExecContext(ctx, `DELETE FROM likes WHERE user_id = ? AND video_id = ?`, userID, videoID)
	}
	if err != nil {
		return fmt.Errorf("save like: %w", err)
	}
	return nil
}
