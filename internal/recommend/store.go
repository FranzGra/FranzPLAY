package recommend

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// store reads what the rules need. It never writes.
type store struct {
	db *sql.DB
}

// videos returns every visible video. Only the few columns the rules use
// are read: even ten thousand videos take little memory.
func (s store) videos(ctx context.Context) (_ []Video, err error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, title, category, added_at FROM videos WHERE visible`)
	if err != nil {
		return nil, fmt.Errorf("read videos: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	var out []Video
	for rows.Next() {
		var v Video
		if err := rows.Scan(&v.ID, &v.Title, &v.Category, &v.AddedAt); err != nil {
			return nil, fmt.Errorf("read videos: %w", err)
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read videos: %w", err)
	}
	return out, nil
}

// together counts, for each video, the other people (not userID) who
// watched it as well as videoID.
func (s store) together(ctx context.Context, videoID, userID int64) (map[int64]int, error) {
	return s.counts(ctx, `
		SELECT b.video_id, count(DISTINCT b.user_id)
		FROM watch_progress a JOIN watch_progress b ON b.user_id = a.user_id AND b.video_id != a.video_id
		WHERE a.video_id = ? AND a.user_id != ?
		GROUP BY b.video_id`, videoID, userID)
}

// others counts, for each video, the other people (not userID) who
// watched or liked it.
func (s store) others(ctx context.Context, userID int64) (map[int64]int, error) {
	return s.counts(ctx, `
		SELECT video_id, count(DISTINCT user_id) FROM (
			SELECT user_id, video_id FROM watch_progress
			UNION SELECT user_id, video_id FROM likes)
		WHERE user_id != ?
		GROUP BY video_id`, userID)
}

// finished returns the videos userID watched to the end.
func (s store) finished(ctx context.Context, userID int64) (map[int64]bool, error) {
	counts, err := s.counts(ctx, `SELECT video_id, 1 FROM watch_progress WHERE user_id = ? AND finished`, userID)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]bool, len(counts))
	for id := range counts {
		out[id] = true
	}
	return out, nil
}

// taste returns what userID watched and liked.
func (s store) taste(ctx context.Context, userID int64) (_ Taste, err error) {
	t := Taste{Categories: map[string]int{}, Known: map[int64]bool{}}
	rows, err := s.db.QueryContext(ctx, `
		SELECT x.video_id, v.category, x.points FROM (
			SELECT video_id, 1 AS points FROM watch_progress WHERE user_id = ?
			UNION ALL SELECT video_id, 2 FROM likes WHERE user_id = ?) x
		JOIN videos v ON v.id = x.video_id`, userID, userID)
	if err != nil {
		return Taste{}, fmt.Errorf("read taste: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		var id int64
		var category string
		var points int
		if err := rows.Scan(&id, &category, &points); err != nil {
			return Taste{}, fmt.Errorf("read taste: %w", err)
		}
		t.Known[id] = true
		if category != "" {
			t.Categories[category] += points
		}
	}
	if err := rows.Err(); err != nil {
		return Taste{}, fmt.Errorf("read taste: %w", err)
	}
	return t, nil
}

// counts runs a query whose rows are a video id and a number.
func (s store) counts(ctx context.Context, query string, args ...any) (_ map[int64]int, err error) {
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("count watched: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := map[int64]int{}
	for rows.Next() {
		var id int64
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, fmt.Errorf("count watched: %w", err)
		}
		out[id] = n
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("count watched: %w", err)
	}
	return out, nil
}
