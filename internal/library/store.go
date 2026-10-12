package library

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
)

// store reads and writes the catalog tables. All the decisions are made
// elsewhere (reconcile.go); the store only carries them out.
type store struct {
	db *sql.DB
}

// libraryIDs returns the id of each library folder, adding the new ones.
func (s store) libraryIDs(ctx context.Context, paths []string) (ids map[string]int64, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("libraries: begin: %w", err)
	}
	defer func() { err = finish(tx, err) }()

	ids = make(map[string]int64, len(paths))
	for _, p := range paths {
		if _, err := tx.ExecContext(ctx, `INSERT INTO libraries (path) VALUES (?) ON CONFLICT (path) DO NOTHING`, p); err != nil {
			return nil, fmt.Errorf("add library %q: %w", p, err)
		}
		var id int64
		if err := tx.QueryRowContext(ctx, `SELECT id FROM libraries WHERE path = ?`, p).Scan(&id); err != nil {
			return nil, fmt.Errorf("read library %q: %w", p, err)
		}
		ids[p] = id
	}
	return ids, nil
}

// knownVideos returns every video in the catalog, present or missing.
func (s store) knownVideos(ctx context.Context) (_ []known, err error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, fingerprint, library_id, path, size, mod_time, missing_since IS NOT NULL
		FROM videos`)
	if err != nil {
		return nil, fmt.Errorf("read videos: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()

	var videos []known
	for rows.Next() {
		var k known
		if err := rows.Scan(&k.id, &k.fingerprint, &k.loc.library, &k.loc.path, &k.size, &k.modTime, &k.missing); err != nil {
			return nil, fmt.Errorf("read videos: %w", err)
		}
		videos = append(videos, k)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read videos: %w", err)
	}
	return videos, nil
}

// apply saves what a scan decided, all in one transaction: if anything
// fails, the catalog stays exactly as it was.
func (s store) apply(ctx context.Context, ch changes, now time.Time) (err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("save scan: begin: %w", err)
	}
	defer func() { err = finish(tx, err) }()

	stamp := now.Unix()
	for _, id := range ch.gone {
		if _, err := tx.ExecContext(ctx,
			`UPDATE videos SET missing_since = ? WHERE id = ? AND missing_since IS NULL`, stamp, id); err != nil {
			return fmt.Errorf("mark video %d missing: %w", id, err)
		}
	}

	// Videos that change place first leave their old place, so that two
	// videos can swap names without ever being in the same place.
	for _, u := range ch.updates {
		if _, err := tx.ExecContext(ctx,
			`UPDATE videos SET missing_since = ? WHERE id = ?`, stamp, u.id); err != nil {
			return fmt.Errorf("update video %d: %w", u.id, err)
		}
	}
	for _, u := range ch.updates {
		f := u.file
		if _, err := tx.ExecContext(ctx, `
			UPDATE videos
			SET fingerprint = ?, library_id = ?, path = ?, size = ?, mod_time = ?,
			    title = ?, category = ?, missing_since = NULL
			WHERE id = ?`,
			f.fingerprint, f.loc.library, f.loc.path, f.size, f.modTime,
			titleOf(f.loc.path), categoryOf(f.loc.path), u.id); err != nil {
			return fmt.Errorf("update video %d: %w", u.id, err)
		}
		switch {
		case u.kind == replaced:
			// New content: what we knew about the old file is no longer true.
			if err := jobs.Enqueue(ctx, tx, u.id, jobs.Probe, false, now); err != nil {
				return err
			}
		case u.wasMissing:
			// Same content back: read it, look for the subtitles inside it
			// and make its copy for the browsers, only if that never succeeded.
			for _, k := range []jobs.Kind{jobs.Probe, jobs.Tracks, jobs.Convert} {
				if err := jobs.Enqueue(ctx, tx, u.id, k, true, now); err != nil {
					return err
				}
			}
		}
	}

	for _, f := range ch.added {
		res, err := tx.ExecContext(ctx, `
			INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, category, added_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			f.fingerprint, f.loc.library, f.loc.path, f.size, f.modTime,
			titleOf(f.loc.path), categoryOf(f.loc.path), stamp)
		if err != nil {
			return fmt.Errorf("add video %s: %w", f.loc.path, err)
		}
		id, err := res.LastInsertId()
		if err != nil {
			return fmt.Errorf("add video %s: %w", f.loc.path, err)
		}
		if err := jobs.Enqueue(ctx, tx, id, jobs.Probe, false, now); err != nil {
			return err
		}
	}
	return nil
}

// forget deletes the videos missing since before the given time. Only the
// catalog row goes away: the video file, if it still exists somewhere, is
// never touched. It returns how many videos were forgotten.
func (s store) forget(ctx context.Context, missingBefore time.Time) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM videos WHERE missing_since IS NOT NULL AND missing_since < ?`, missingBefore.Unix())
	if err != nil {
		return 0, fmt.Errorf("forget missing videos: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("forget missing videos: %w", err)
	}
	return n, nil
}

// finish commits the transaction when err is nil, and rolls it back otherwise.
func finish(tx *sql.Tx, err error) error {
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
