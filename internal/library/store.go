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
	// batch is how many videos one transaction adds or forgets at most
	// (defaultBatch when zero). A long transaction would make everyone
	// else's writes wait: likes, progress, the job queue.
	batch int
}

// defaultBatch keeps each transaction well under a second on a Raspberry Pi.
const defaultBatch = 500

func (s store) batchSize() int {
	if s.batch > 0 {
		return s.batch
	}
	return defaultBatch
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

// apply saves what a scan decided. Missing and moved videos are saved in
// one transaction: if anything fails, they stay exactly as they were. New
// videos are then added a batch at a time, so a first scan of 50,000 videos
// does not hold the database for a minute; if a batch fails, the next scan
// finds the videos still missing from the catalog and adds them.
func (s store) apply(ctx context.Context, ch changes, now time.Time) error {
	if err := s.applyChanges(ctx, ch, now); err != nil {
		return err
	}
	for added := ch.added; len(added) > 0; {
		n := min(len(added), s.batchSize())
		if err := s.add(ctx, added[:n], now); err != nil {
			return err
		}
		added = added[n:]
	}
	return nil
}

// applyChanges saves the videos gone missing and the ones that changed.
func (s store) applyChanges(ctx context.Context, ch changes, now time.Time) (err error) {
	if len(ch.gone) == 0 && len(ch.updates) == 0 {
		return nil
	}
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
			    -- An uploaded video keeps the title its person gave it.
			    title = CASE WHEN uploaded_by IS NULL THEN ? ELSE title END,
			    folder_category = CASE WHEN uploaded_by IS NULL THEN ? ELSE folder_category END,
			    missing_since = NULL
			WHERE id = ?`,
			f.fingerprint, f.loc.library, f.loc.path, f.size, f.modTime,
			titleOf(f.loc.path), categoryOf(f.loc.path), u.id); err != nil {
			return fmt.Errorf("update video %d: %w", u.id, err)
		}
		switch {
		case u.kind == replaced:
			// New content: what we knew about the old file is no longer true.
			for _, k := range []jobs.Kind{jobs.Probe, jobs.Details, jobs.Online} {
				if err := jobs.Enqueue(ctx, tx, u.id, k, false, now); err != nil {
					return err
				}
			}
		case u.wasMissing:
			// Same content back: read it and its details file, look for the
			// subtitles inside it and make its copy for the browsers, only
			// if that never succeeded.
			for _, k := range []jobs.Kind{jobs.Probe, jobs.Details, jobs.Online, jobs.Tracks, jobs.Convert} {
				if err := jobs.Enqueue(ctx, tx, u.id, k, true, now); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// add puts new videos in the catalog, in one transaction.
func (s store) add(ctx context.Context, added []identified, now time.Time) (err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("save new videos: begin: %w", err)
	}
	defer func() { err = finish(tx, err) }()

	stamp := now.Unix()
	for _, f := range added {
		res, err := tx.ExecContext(ctx, `
			INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, folder_category, added_at)
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
		for _, k := range []jobs.Kind{jobs.Probe, jobs.Details, jobs.Online} {
			if err := jobs.Enqueue(ctx, tx, id, k, false, now); err != nil {
				return err
			}
		}
	}
	return nil
}

// forget deletes the videos missing since before the given time. Only the
// catalog row goes away: the video file, if it still exists somewhere, is
// never touched. It returns how many videos were forgotten.
// Like apply, it works a batch at a time: forgetting a whole disk also
// deletes every like, comment and history row of its videos.
func (s store) forget(ctx context.Context, missingBefore time.Time) (int64, error) {
	var total int64
	for {
		res, err := s.db.ExecContext(ctx, `
			DELETE FROM videos WHERE id IN (
				SELECT id FROM videos WHERE missing_since IS NOT NULL AND missing_since < ? LIMIT ?)`,
			missingBefore.Unix(), s.batchSize())
		if err != nil {
			return total, fmt.Errorf("forget missing videos: %w", err)
		}
		n, err := res.RowsAffected()
		if err != nil {
			return total, fmt.Errorf("forget missing videos: %w", err)
		}
		total += n
		if n < int64(s.batchSize()) {
			return total, nil
		}
	}
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
