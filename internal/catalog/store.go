package catalog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path"
	"path/filepath"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/video"
)

// errNotFound means there is no present video with that id.
var errNotFound = errors.New("video not found")

// Video is one video as the interface sees it.
type Video struct {
	ID       int64     `json:"id"`
	Title    string    `json:"title"`
	Category string    `json:"category"` // "" = none
	Duration *int64    `json:"duration"` // seconds; null = not read yet
	Width    *int      `json:"width"`    // on screen; null = not read yet
	Height   *int      `json:"height"`   // on screen; null = not read yet
	Cover    *string   `json:"cover"`    // address of the image; null = none yet
	AddedAt  time.Time `json:"addedAt"`  // when FranzPLAY found it
	Playable bool      `json:"playable"` // every browser can play it as it is
}

// Category is a category with how many videos it has.
type Category struct {
	Name   string `json:"name"`
	Videos int    `json:"videos"`
}

// store reads the catalog. It never writes: the library scan and the job
// queue are the only writers (rule 4).
type store struct {
	db *sql.DB
}

// videoColumns are read for every video, in the order scanVideo expects.
const videoColumns = `v.id, v.title, v.category, v.duration, v.width, v.height, v.cover, v.added_at,
	v.path, v.video_codec, v.audio_codec`

// rowScanner is a *sql.Row or *sql.Rows.
type rowScanner interface{ Scan(dest ...any) error }

func scanVideo(row rowScanner) (Video, error) {
	var v Video
	var duration, width, height sql.NullInt64
	var cover, videoCodec, audioCodec sql.NullString
	var addedAt int64
	var relPath string
	if err := row.Scan(&v.ID, &v.Title, &v.Category, &duration, &width, &height, &cover, &addedAt,
		&relPath, &videoCodec, &audioCodec); err != nil {
		return Video{}, err
	}
	if duration.Valid {
		v.Duration = &duration.Int64
	}
	if width.Valid && height.Valid {
		w, h := int(width.Int64), int(height.Int64)
		v.Width, v.Height = &w, &h
	}
	if cover.Valid {
		address := "/api/covers/" + cover.String
		v.Cover = &address
	}
	v.AddedAt = time.Unix(addedAt, 0).UTC()
	v.Playable = video.DirectlyPlayable(path.Ext(relPath),
		video.Info{VideoCodec: videoCodec.String, AudioCodec: audioCodec.String})
	return v, nil
}

// list returns a page of present videos, newest first, and how many there
// are in total for that query.
func (s store) list(ctx context.Context, q listQuery) (_ []Video, total int, err error) {
	where := `v.missing_since IS NULL`
	args := []any{}
	if q.category != "" {
		where += ` AND v.category = ?`
		args = append(args, q.category)
	}
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM videos v WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count videos: %w", err)
	}

	rows, err := s.db.QueryContext(ctx, `SELECT `+videoColumns+` FROM videos v WHERE `+where+`
		ORDER BY v.added_at DESC, v.id DESC LIMIT ? OFFSET ?`, append(args, q.limit, q.offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("list videos: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	videos := []Video{}
	for rows.Next() {
		v, err := scanVideo(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("list videos: %w", err)
		}
		videos = append(videos, v)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("list videos: %w", err)
	}
	return videos, total, nil
}

// get returns one present video.
func (s store) get(ctx context.Context, id int64) (Video, error) {
	v, err := scanVideo(s.db.QueryRowContext(ctx,
		`SELECT `+videoColumns+` FROM videos v WHERE v.id = ? AND v.missing_since IS NULL`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return Video{}, errNotFound
	}
	if err != nil {
		return Video{}, fmt.Errorf("read video %d: %w", id, err)
	}
	return v, nil
}

// categories returns the categories that have present videos, by name.
func (s store) categories(ctx context.Context) (_ []Category, err error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT category, count(*) FROM videos
		WHERE missing_since IS NULL AND category != ''
		GROUP BY category ORDER BY category COLLATE NOCASE`)
	if err != nil {
		return nil, fmt.Errorf("list categories: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := []Category{}
	for rows.Next() {
		var c Category
		if err := rows.Scan(&c.Name, &c.Videos); err != nil {
			return nil, fmt.Errorf("list categories: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// file returns the full path of a present video's file.
func (s store) file(ctx context.Context, id int64) (string, error) {
	var root, rel string
	err := s.db.QueryRowContext(ctx, `
		SELECT l.path, v.path FROM videos v JOIN libraries l ON l.id = v.library_id
		WHERE v.id = ? AND v.missing_since IS NULL`, id).Scan(&root, &rel)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errNotFound
	}
	if err != nil {
		return "", fmt.Errorf("find video %d: %w", id, err)
	}
	return filepath.Join(root, filepath.FromSlash(rel)), nil
}
