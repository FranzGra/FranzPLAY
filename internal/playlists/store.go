package playlists

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/sharing"
)

// row is a list as stored, with what the lists page shows about it.
type row struct {
	id        int64
	owner     int64
	ownerName string
	kind      Kind
	name      string // "" for WatchLater
	public    bool   // on the owner's channel
	updatedAt time.Time
	videos    int   // present videos
	first     int64 // first present video, for the cover; 0 = none
	contains  bool  // has the video asked about
}

type store struct {
	db *sql.DB
}

// present means a video that is in the library now: a missing video stays
// in its lists, hidden, and comes back if its disk does (rule 3).
const present = `JOIN videos v ON v.id = i.video_id AND v.visible`

const selectRow = `SELECT p.id, p.user_id, u.name, p.kind, p.name, p.public, p.updated_at,
	(SELECT count(*) FROM playlist_items i ` + present + ` WHERE i.playlist_id = p.id),
	coalesce((SELECT i.video_id FROM playlist_items i ` + present + `
		WHERE i.playlist_id = p.id ORDER BY i.position LIMIT 1), 0),
	EXISTS (SELECT 1 FROM playlist_items i WHERE i.playlist_id = p.id AND i.video_id = ?)
	FROM playlists p JOIN users u ON u.id = p.user_id`

func scanRow(sc interface{ Scan(...any) error }) (row, error) {
	var r row
	var updated int64
	if err := sc.Scan(&r.id, &r.owner, &r.ownerName, &r.kind, &r.name, &r.public, &updated, &r.videos, &r.first, &r.contains); err != nil {
		return row{}, err
	}
	r.updatedAt = time.Unix(updated, 0).UTC()
	return r, nil
}

// list returns the lists of a person: "Guarda più tardi" first (made now
// if it is not there yet), then the most recently changed. contains says
// for each one whether it has videoID (0 = no video asked about).
func (s store) list(ctx context.Context, userID, videoID int64, now time.Time) (list []row, err error) {
	if _, err := s.db.ExecContext(ctx, `INSERT INTO playlists (user_id, kind, name, created_at, updated_at)
		VALUES (?, 'later', '', ?, ?) ON CONFLICT DO NOTHING`, userID, now.Unix(), now.Unix()); err != nil {
		return nil, fmt.Errorf("make watch later of user %d: %w", userID, err)
	}
	rows, err := s.db.QueryContext(ctx, selectRow+` WHERE p.user_id = ?
		ORDER BY p.kind = 'later' DESC, p.updated_at DESC, p.id DESC`, videoID, userID)
	if err != nil {
		return nil, fmt.Errorf("list playlists of user %d: %w", userID, err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		r, err := scanRow(rows)
		if err != nil {
			return nil, fmt.Errorf("read playlist: %w", err)
		}
		list = append(list, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list playlists of user %d: %w", userID, err)
	}
	return list, nil
}

// sharedWith is true for a list shared with the person, the one argument.
const sharedWith = `EXISTS (SELECT 1 FROM playlist_shares s WHERE s.playlist_id = p.id AND s.user_id = ?)`

// get returns a list the person may see: one of theirs, a public one, or
// one shared with them. Someone else's private list is not found, so
// nobody learns it exists.
func (s store) get(ctx context.Context, userID, id int64) (row, error) {
	r, err := scanRow(s.db.QueryRowContext(ctx, selectRow+` WHERE p.id = ? AND (p.user_id = ? OR p.public OR `+
		sharedWith+`)`, 0, id, userID, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return row{}, errNotFound
	}
	if err != nil {
		return row{}, fmt.Errorf("read playlist %d: %w", id, err)
	}
	return r, nil
}

// publicOf returns the public lists of a person, the most recently
// changed first.
func (s store) publicOf(ctx context.Context, owner int64) (list []row, err error) {
	return s.rows(ctx, `p.user_id = ? AND p.public`, owner)
}

// sharedWithMe returns the lists others shared with a person, the most
// recently changed first.
func (s store) sharedWithMe(ctx context.Context, userID int64) (list []row, err error) {
	return s.rows(ctx, `NOT p.public AND `+sharedWith, userID)
}

// rows returns the lists matching where, the most recently changed first.
func (s store) rows(ctx context.Context, where string, args ...any) (list []row, err error) {
	rows, err := s.db.QueryContext(ctx, selectRow+` WHERE `+where+`
		ORDER BY p.updated_at DESC, p.id DESC`, append([]any{0}, args...)...)
	if err != nil {
		return nil, fmt.Errorf("list playlists: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		r, err := scanRow(rows)
		if err != nil {
			return nil, fmt.Errorf("read playlist: %w", err)
		}
		list = append(list, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list playlists: %w", err)
	}
	return list, nil
}

// people returns the people each of the lists ids is shared with, by name.
func (s store) people(ctx context.Context, ids []int64) (map[int64][]sharing.Person, error) {
	if len(ids) == 0 {
		return map[int64][]sharing.Person{}, nil
	}
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	return sharing.People(ctx, s.db, `SELECT s.playlist_id, u.id, u.name, u.avatar
		FROM playlist_shares s JOIN users u ON u.id = s.user_id
		WHERE s.playlist_id IN (`+strings.Repeat(",?", len(ids))[1:]+`)
		ORDER BY u.name COLLATE NOCASE, u.id`, args...)
}

// create makes a new list.
func (s store) create(ctx context.Context, userID int64, name string, now time.Time) (row, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return row{}, fmt.Errorf("create playlist: %w", err)
	}
	defer func() { _ = tx.Rollback() }() // after Commit it does nothing
	var n int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM playlists WHERE user_id = ?`, userID).Scan(&n); err != nil {
		return row{}, fmt.Errorf("count playlists of user %d: %w", userID, err)
	}
	if n >= maxPlaylists {
		return row{}, errTooMany
	}
	res, err := tx.ExecContext(ctx, `INSERT INTO playlists (user_id, kind, name, created_at, updated_at)
		VALUES (?, 'playlist', ?, ?, ?)`, userID, name, now.Unix(), now.Unix())
	if err != nil {
		return row{}, fmt.Errorf("create playlist: %w", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return row{}, fmt.Errorf("create playlist: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return row{}, fmt.Errorf("create playlist: %w", err)
	}
	return s.get(ctx, userID, id)
}

// rename gives an ordinary list a new name.
func (s store) rename(ctx context.Context, id int64, name string, now time.Time) error {
	if _, err := s.db.ExecContext(ctx, `UPDATE playlists SET name = ?, updated_at = ? WHERE id = ? AND kind = 'playlist'`,
		name, now.Unix(), id); err != nil {
		return fmt.Errorf("rename playlist %d: %w", id, err)
	}
	return nil
}

// audience changes who sees an ordinary list: on the owner's channel for
// everybody (public), and the people it is shared with otherwise, already
// cleaned. What is nil stays. A public list is shared with nobody. It does
// not count as a change to the list.
func (s store) audience(ctx context.Context, id int64, public *bool, people *[]int64) (err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("change who sees playlist %d: %w", id, err)
	}
	defer func() {
		if err == nil {
			if err = tx.Commit(); err != nil {
				err = fmt.Errorf("change who sees playlist %d: %w", id, err)
			}
			return
		}
		_ = tx.Rollback() // the error that matters is err
	}()
	var nowPublic bool
	if err := tx.QueryRowContext(ctx, `UPDATE playlists SET public = coalesce(?, public)
		WHERE id = ? AND kind = 'playlist' RETURNING public`, public, id).Scan(&nowPublic); err != nil {
		return fmt.Errorf("change who sees playlist %d: %w", id, err)
	}
	if nowPublic && people != nil && len(*people) > 0 {
		return sharing.ErrNotPrivate
	}
	if !nowPublic && people == nil {
		return nil // the same people as before
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM playlist_shares WHERE playlist_id = ?`, id); err != nil {
		return fmt.Errorf("change who sees playlist %d: %w", id, err)
	}
	if nowPublic {
		return nil
	}
	if err := sharing.Known(ctx, tx, *people); err != nil {
		return err
	}
	for _, person := range *people {
		if _, err := tx.ExecContext(ctx, `INSERT INTO playlist_shares (playlist_id, user_id) VALUES (?, ?)`,
			id, person); err != nil {
			return fmt.Errorf("change who sees playlist %d: %w", id, err)
		}
	}
	return nil
}

// remove deletes a list; its videos stay in the library.
func (s store) remove(ctx context.Context, id int64) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM playlists WHERE id = ?`, id); err != nil {
		return fmt.Errorf("delete playlist %d: %w", id, err)
	}
	return nil
}

// videoIDs returns the videos of a list, in order.
func (s store) videoIDs(ctx context.Context, id int64) (ids []int64, err error) {
	rows, err := s.db.QueryContext(ctx, `SELECT video_id FROM playlist_items WHERE playlist_id = ?
		ORDER BY position, added_at`, id)
	if err != nil {
		return nil, fmt.Errorf("read videos of playlist %d: %w", id, err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		var v int64
		if err := rows.Scan(&v); err != nil {
			return nil, fmt.Errorf("read videos of playlist %d: %w", id, err)
		}
		ids = append(ids, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read videos of playlist %d: %w", id, err)
	}
	return ids, nil
}

// add puts a video at the end of a list. A video already there stays
// where it is.
func (s store) add(ctx context.Context, id, videoID int64, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("add video %d to playlist %d: %w", videoID, id, err)
	}
	defer func() { _ = tx.Rollback() }() // after Commit it does nothing
	var one int
	err = tx.QueryRowContext(ctx, `SELECT 1 FROM videos WHERE id = ? AND visible`, videoID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return errVideoNotFound
	}
	if err != nil {
		return fmt.Errorf("read video %d: %w", videoID, err)
	}
	var there bool
	var n, last int64
	if err := tx.QueryRowContext(ctx, `SELECT
			EXISTS (SELECT 1 FROM playlist_items WHERE playlist_id = ?1 AND video_id = ?2),
			count(*), coalesce(max(position), 0)
		FROM playlist_items WHERE playlist_id = ?1`, id, videoID).Scan(&there, &n, &last); err != nil {
		return fmt.Errorf("read playlist %d: %w", id, err)
	}
	if there {
		return nil
	}
	if n >= maxVideos {
		return errFull
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO playlist_items (playlist_id, video_id, position, added_at)
		VALUES (?, ?, ?, ?)`, id, videoID, last+1, now.Unix()); err != nil {
		return fmt.Errorf("add video %d to playlist %d: %w", videoID, id, err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE playlists SET updated_at = ? WHERE id = ?`, now.Unix(), id); err != nil {
		return fmt.Errorf("add video %d to playlist %d: %w", videoID, id, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("add video %d to playlist %d: %w", videoID, id, err)
	}
	return nil
}

// take removes a video from a list.
func (s store) take(ctx context.Context, id, videoID int64) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM playlist_items WHERE playlist_id = ? AND video_id = ?`,
		id, videoID); err != nil {
		return fmt.Errorf("remove video %d from playlist %d: %w", videoID, id, err)
	}
	return nil
}
