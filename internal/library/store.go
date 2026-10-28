package library

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
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

// syncCoverImages saves the version of the picture next to each video of
// a library (covers, by path: listing.coverImages) and asks for a new
// cover where it changed: a picture put there later, replaced or taken
// away. The first time a video is looked at, a picture found also asks
// for a new cover; no picture asks for nothing. It returns how many covers
// were asked for. Only videos present in the library are looked at.
func (s store) syncCoverImages(ctx context.Context, library int64, covers map[string]string, now time.Time) (int, error) {
	type change struct {
		id      int64
		version string
		redo    bool
	}
	var changes []change
	err := func() (err error) {
		rows, err := s.db.QueryContext(ctx, `
			SELECT id, path, cover_image FROM videos WHERE library_id = ? AND missing_since IS NULL`, library)
		if err != nil {
			return err
		}
		defer func() { err = errors.Join(err, rows.Close()) }()
		for rows.Next() {
			var id int64
			var p string
			var before sql.NullString
			if err := rows.Scan(&id, &p, &before); err != nil {
				return err
			}
			version, listed := covers[p]
			if !listed || (before.Valid && before.String == version) {
				continue
			}
			changes = append(changes, change{id: id, version: version, redo: before.Valid || version != ""})
		}
		return rows.Err()
	}()
	if err != nil {
		return 0, fmt.Errorf("read cover pictures: %w", err)
	}

	asked := 0
	for batch := range slices.Chunk(changes, s.batchSize()) {
		err := func() (err error) {
			tx, err := s.db.BeginTx(ctx, nil)
			if err != nil {
				return fmt.Errorf("save cover pictures: begin: %w", err)
			}
			defer func() { err = finish(tx, err) }()
			for _, c := range batch {
				if _, err := tx.ExecContext(ctx, `UPDATE videos SET cover_image = ? WHERE id = ?`, c.version, c.id); err != nil {
					return fmt.Errorf("save cover picture of video %d: %w", c.id, err)
				}
				if c.redo {
					if err := jobs.Enqueue(ctx, tx, c.id, jobs.Cover, false, now); err != nil {
						return err
					}
				}
			}
			return nil
		}()
		if err != nil {
			return asked, err
		}
		for _, c := range batch {
			if c.redo {
				asked++
			}
		}
	}
	return asked, nil
}

// syncCategoryPictures saves the pictures of the categories found in a
// library: new ones are added, changed ones wait for a new copy, the ones
// gone are forgotten. It reports whether any copy is left to make, and
// whether a picture was forgotten.
func (s store) syncCategoryPictures(ctx context.Context, library int64, pictures []categoryPicture) (toMake, forgot bool, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, false, fmt.Errorf("save category pictures: begin: %w", err)
	}
	defer func() { err = finish(tx, err) }()

	if _, err := tx.ExecContext(ctx, `CREATE TEMP TABLE IF NOT EXISTS seen_pictures (path TEXT PRIMARY KEY)`); err != nil {
		return false, false, fmt.Errorf("save category pictures: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM temp.seen_pictures`); err != nil {
		return false, false, fmt.Errorf("save category pictures: %w", err)
	}
	for _, p := range pictures {
		// A changed picture waits for a new copy; the one made before
		// stays until then.
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO category_pictures (library_id, path, category, size, mod_time) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (library_id, path) DO UPDATE SET size = excluded.size, mod_time = excluded.mod_time, pending = 1
			WHERE size != excluded.size OR mod_time != excluded.mod_time`,
			library, p.path, p.category, p.size, p.modTime); err != nil {
			return false, false, fmt.Errorf("save category picture %s: %w", p.path, err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO temp.seen_pictures (path) VALUES (?)`, p.path); err != nil {
			return false, false, fmt.Errorf("save category pictures: %w", err)
		}
	}
	res, err := tx.ExecContext(ctx, `
		DELETE FROM category_pictures
		WHERE library_id = ? AND path NOT IN (SELECT path FROM temp.seen_pictures)`, library)
	if err != nil {
		return false, false, fmt.Errorf("forget category pictures: %w", err)
	}
	gone, err := res.RowsAffected()
	if err != nil {
		return false, false, fmt.Errorf("forget category pictures: %w", err)
	}
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (SELECT 1 FROM category_pictures WHERE library_id = ? AND pending = 1)`, library).Scan(&toMake); err != nil {
		return false, false, fmt.Errorf("read category pictures: %w", err)
	}
	return toMake, gone > 0, nil
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
