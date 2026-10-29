package recommend

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"
)

// store reads what the rules need. It never writes.
type store struct {
	db    *sql.DB
	cache *library
}

func newStore(db *sql.DB) store { return store{db: db, cache: &library{}} }

// library is the copy of the visible videos kept between requests: every
// Home and every video page needs all of them, and reading ten thousand
// rows each time was most of the server's work. It is read again only
// when videos_version says the videos changed.
type library struct {
	mu      sync.Mutex
	loaded  bool
	version int64
	videos  []Video
}

// videos returns every visible video, with titles in small letters (the
// rules only compare words). The list is shared: callers must not change it.
func (s store) videos(ctx context.Context) ([]Video, error) {
	s.cache.mu.Lock()
	defer s.cache.mu.Unlock()
	// The number first: a change that lands between the two reads makes
	// the next request read again, never keeps an old list.
	var version int64
	if err := s.db.QueryRowContext(ctx, `SELECT n FROM videos_version WHERE id = 1`).Scan(&version); err != nil {
		return nil, fmt.Errorf("read videos version: %w", err)
	}
	if s.cache.loaded && s.cache.version == version {
		return s.cache.videos, nil
	}
	all, err := s.readVideos(ctx)
	if err != nil {
		return nil, err
	}
	s.cache.loaded, s.cache.version, s.cache.videos = true, version, all
	return all, nil
}

// readVideos reads every visible video. Only the few columns the rules
// use are read: even ten thousand videos take little memory.
func (s store) readVideos(ctx context.Context) (_ []Video, err error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, shown_title, category, added_at FROM videos WHERE visible`)
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
		v.Title = strings.ToLower(v.Title)
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
