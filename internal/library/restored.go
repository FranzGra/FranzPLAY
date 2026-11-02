package library

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/jobs"
)

// keyAfterRestore is the settings row that says the database came back from a
// copy and its rows are not yet in line with the folders, and when that copy was
// made (Unix seconds, 0 if not known). It stays until they are, so a stop in the
// middle does the work again at the next start.
const keyAfterRestore = "content.after_restore"

// PutBackAfterRestore brings the rows of a database that came back from a copy in
// line with the folders of the videos. The copy is up to a day older than the
// disk: if a subtitle took 4 hours after the copy, it is not made again. Who may
// see a video is not taken on trust: a video.json written after the copy wins,
// and only if it says so (its savedAt); otherwise the more closed of the two
// wins, since a video.json that could not be written is behind the database.
// What a video.json does not say stays as the row has it. Videos that arrived
// after the copy need nothing here: the scan finds them new and adopts them. It
// must run before the cleanings and the job worker. copyMadeAt is when the copy
// was made, zero when not known.
//
// Contents that cannot be read give an error, and the work stays to do.
func PutBackAfterRestore(ctx context.Context, db *sql.DB, r content.Root, restored bool, copyMadeAt time.Time,
	now time.Time, logger *slog.Logger,
) error {
	if restored {
		madeAt := int64(0)
		if !copyMadeAt.IsZero() {
			madeAt = copyMadeAt.Unix()
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING`,
			keyAfterRestore, strconv.FormatInt(madeAt, 10)); err != nil {
			return fmt.Errorf("after a restore: %w", err)
		}
	}
	var value string
	err := db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, keyAfterRestore).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("after a restore: %w", err)
	}
	copyMadeAt = time.Time{}
	if seconds, err := strconv.ParseInt(value, 10, 64); err == nil && seconds > 1 {
		copyMadeAt = time.Unix(seconds, 0)
	}
	if err := content.PrepareAfterRestore(ctx, db, now); err != nil {
		return err
	}
	videos, err := allFingerprints(ctx, db)
	if err != nil {
		return fmt.Errorf("after a restore: %w", err)
	}
	fingerprints := make([]string, 0, len(videos))
	for fingerprint := range videos {
		fingerprints = append(fingerprints, fingerprint)
	}
	found, err := r.Reuse(ctx, fingerprints, logger)
	if err != nil {
		return fmt.Errorf("after a restore: %w", err)
	}
	updated := 0
	for fingerprint, u := range found {
		if u.Unreadable {
			continue // the row is the only thing left that says anything
		}
		err := func() (err error) {
			tx, err := db.BeginTx(ctx, nil)
			if err != nil {
				return err
			}
			defer func() { err = finish(tx, err) }()
			return fillFromNewerFolder(ctx, tx, videos[fingerprint], u, copyMadeAt, now)
		}()
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			logger.WarnContext(ctx, "row of a video not brought in line with its folder", "folder", u.Folder, "error", err)
			continue
		}
		updated++
	}
	logger.InfoContext(ctx, "rows brought in line with the folders after a restore", "videos", updated)
	if err := content.PutBackCategories(ctx, db, r, copyMadeAt, logger); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM settings WHERE key = ?`, keyAfterRestore); err != nil {
		return fmt.Errorf("after a restore: %w", err)
	}
	return nil
}

// allFingerprints returns the id of every video, by fingerprint.
func allFingerprints(ctx context.Context, db *sql.DB) (_ map[string]int64, err error) {
	rows, err := db.QueryContext(ctx, `SELECT fingerprint, id FROM videos`)
	if err != nil {
		return nil, err
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	videos := map[string]int64{}
	for rows.Next() {
		var fingerprint string
		var id int64
		if err := rows.Scan(&fingerprint, &id); err != nil {
			return nil, err
		}
		videos[fingerprint] = id
	}
	return videos, rows.Err()
}

// fillFromNewerFolder gives an existing row what its folder holds, which is never
// older. A value the folder does not have stays as the row has it: a file not yet
// transferred is still named by its old name, and it is still there. Who may see
// the video is the exception (see PutBackAfterRestore).
func fillFromNewerFolder(ctx context.Context, tx *sql.Tx, id int64, u *content.Reused, copyMadeAt, now time.Time) error {
	if a := u.Access; a != nil {
		newer := !copyMadeAt.IsZero() && u.SavedAt > copyMadeAt.Unix()
		if _, err := tx.ExecContext(ctx, `UPDATE videos SET
			hidden_at = CASE WHEN ? THEN ? ELSE coalesce(hidden_at, ?) END,
			private = CASE WHEN ? THEN ? ELSE private OR ? END
			WHERE id = ?`,
			newer, orNull(a.HiddenAt), orNull(a.HiddenAt), newer, a.Private, a.Private, id); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE videos SET
			cover = coalesce(?, cover), clip = coalesce(?, clip), clip_hd = coalesce(?, clip_hd), converted = coalesce(?, converted),
			own_cover = coalesce(?, own_cover), own_clip = coalesce(?, own_clip), online_cover = coalesce(?, online_cover),
			cover_second = ?, no_clip = ?, cover_image = coalesce(?, cover_image), admin_title = ?, admin_category = ?
		WHERE id = ?`,
		orNull(u.Cover), orNull(u.Clip), orNull(u.ClipHD), orNull(u.Converted),
		orNull(u.OwnCover), orNull(u.OwnClip), orNull(u.OnlineImage),
		u.CoverSecond, u.NoClip, u.CoverImage, u.AdminTitle, u.AdminCategory, id); err != nil {
		return err
	}
	if u.Preview != "" {
		if _, err := tx.ExecContext(ctx, `
			UPDATE videos SET preview = ?, preview_gap = ?, preview_count = ?, preview_width = ?, preview_height = ? WHERE id = ?`,
			u.Preview, u.PreviewGap, u.PreviewCount, u.PreviewWidth, u.PreviewHeight, id); err != nil {
			return err
		}
	}
	if i := u.Info; i != nil {
		if _, err := tx.ExecContext(ctx, `
			UPDATE videos SET duration = ?, width = ?, height = ?, video_codec = ?, audio_codec = ?, container = ?, pixel_format = ?
			WHERE id = ?`, i.Duration, orNull(i.Width), orNull(i.Height), i.VideoCodec, i.AudioCodec, i.Container, i.PixelFormat, id); err != nil {
			return err
		}
		if err := MarkShort(ctx, tx, id); err != nil {
			return err
		}
	}
	for _, s := range u.Inside {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO video_subtitles (video_id, stream, lang, title, forced, file) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (video_id, stream) DO UPDATE SET lang = excluded.lang, title = excluded.title,
				forced = excluded.forced, file = excluded.file`,
			id, *s.Stream, s.Lang, s.Title, s.Forced, s.File); err != nil {
			return err
		}
	}
	for _, s := range u.Auto {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO auto_subtitles (video_id, lang, translated_from, model, fingerprint, file, made_at)
			SELECT ?, ?, ?, ?, fingerprint, ?, ? FROM videos WHERE id = ?
			ON CONFLICT (video_id, lang) DO UPDATE SET translated_from = excluded.translated_from, model = excluded.model,
				fingerprint = excluded.fingerprint, file = excluded.file, made_at = excluded.made_at`,
			id, s.Lang, s.TranslatedFrom, s.Model, s.File, s.MadeAt, id); err != nil {
			return err
		}
	}
	for _, k := range []jobs.Kind{jobs.Probe, jobs.Online, jobs.Cover, jobs.Preview, jobs.Clip, jobs.Tracks, jobs.Convert} {
		if !u.Finished(string(k)) {
			continue
		}
		if err := jobs.MarkDone(ctx, tx, id, k, now); err != nil {
			return err
		}
	}
	return nil
}
