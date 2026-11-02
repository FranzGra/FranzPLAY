package library

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/jobs"
)

// adopt gives a new row of the catalog what the folder of its video already
// holds, and asks only for what is not there. It is all or nothing: if a value of
// the folder does not fit the database, the row stays as it was, and the video
// counts as new.
func adopt(ctx context.Context, tx *sql.Tx, id int64, u *content.Reused, now time.Time) error {
	if _, err := tx.ExecContext(ctx, `SAVEPOINT adopt`); err != nil {
		return fmt.Errorf("adopt: %w", err)
	}
	err := fillFromFolder(ctx, tx, id, u, now)
	if err != nil {
		if _, rbErr := tx.ExecContext(ctx, `ROLLBACK TO adopt`); rbErr != nil {
			return fmt.Errorf("adopt: %w: %w", err, rbErr)
		}
	}
	if _, relErr := tx.ExecContext(ctx, `RELEASE adopt`); relErr != nil && err == nil {
		err = fmt.Errorf("adopt: %w", relErr)
	}
	return err
}

// restoreAccess gives a new row who may see it and when it arrived. It stays out
// of adopt's all or nothing: a folder whose files do not fit the database still
// says the video is hidden. A person is found by name and by when the account was
// made, so only the same account comes back as the owner: a new account with the
// same name, on another installation, is somebody else. With no such account the
// video has no owner, and a private one stays closed to everybody until an
// administrator gives it one.
func restoreAccess(ctx context.Context, tx *sql.Tx, id int64, u *content.Reused) error {
	if u.AddedAt > 0 {
		if _, err := tx.ExecContext(ctx, `UPDATE videos SET added_at = ? WHERE id = ?`, u.AddedAt, id); err != nil {
			return fmt.Errorf("restore who sees a video: %w", err)
		}
	}
	a := u.Access
	if a == nil {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `UPDATE videos SET hidden_at = ?, private = ? WHERE id = ?`,
		orNull(a.HiddenAt), a.Private, id); err != nil {
		return fmt.Errorf("restore who sees a video: %w", err)
	}
	if a.UploadedBy == "" {
		return nil
	}
	// An uploaded video has its title from its person and no category from its
	// folder: the first folder of the uploads is the person.
	if _, err := tx.ExecContext(ctx, `UPDATE videos
		SET uploaded_by = (SELECT id FROM users WHERE name = ? AND created_at = ? AND ? > 0),
		    folder_category = '', title = coalesce(NULLIF(?, ''), title)
		WHERE id = ?`, a.UploadedBy, a.UploadedBySince, a.UploadedBySince, u.Title, id); err != nil {
		return fmt.Errorf("restore who sees a video: %w", err)
	}
	var owner sql.NullInt64
	if err := tx.QueryRowContext(ctx, `SELECT uploaded_by FROM videos WHERE id = ?`, id).Scan(&owner); err != nil {
		return fmt.Errorf("restore who sees a video: %w", err)
	}
	if owner.Valid {
		return nil
	}
	// With no owner nothing says any more that the video was uploaded: a scan and
	// the next video.json would take title and category from its path. They go
	// where they stay, as if the administrator had chosen them.
	if u.AdminTitle == nil && u.Title != "" {
		u.AdminTitle = &u.Title
	}
	if u.AdminCategory == nil {
		none := ""
		u.AdminCategory = &none
	}
	return nil
}

// orNull saves "" and 0 as nothing, as a video with no such value has.
func orNull[T comparable](v T) any {
	var zero T
	if v == zero {
		return nil
	}
	return v
}

// fillFromFolder writes the row, its subtitles and its sound tracks, and says
// which jobs are done.
func fillFromFolder(ctx context.Context, tx *sql.Tx, id int64, u *content.Reused, now time.Time) error {
	// A video to read again has none of these until it is read.
	var duration, width, height, codec, audio, container, pixels any
	if i := u.Info; i != nil {
		duration, width, height = i.Duration, orNull(i.Width), orNull(i.Height)
		codec, audio, container, pixels = i.VideoCodec, i.AudioCodec, i.Container, i.PixelFormat
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE videos SET
			duration = ?, width = ?, height = ?, video_codec = ?, audio_codec = ?, container = ?, pixel_format = ?,
			cover = ?, clip = ?, clip_hd = ?, converted = ?,
			preview = ?, preview_gap = ?, preview_count = ?, preview_width = ?, preview_height = ?,
			own_cover = ?, own_clip = ?, cover_second = ?, no_clip = ?, cover_image = ?,
			admin_title = ?, admin_category = ?,
			online_title = ?, online_description = ?, online_author = ?, online_published_on = ?, online_cover = ?
		WHERE id = ?`,
		duration, width, height, codec, audio, container, pixels,
		orNull(u.Cover), orNull(u.Clip), orNull(u.ClipHD), orNull(u.Converted),
		orNull(u.Preview), orNull(u.PreviewGap), orNull(u.PreviewCount), orNull(u.PreviewWidth), orNull(u.PreviewHeight),
		orNull(u.OwnCover), orNull(u.OwnClip), u.CoverSecond, u.NoClip, u.CoverImage,
		u.AdminTitle, u.AdminCategory,
		orNull(u.Online.Title), orNull(u.Online.Description), orNull(u.Online.Author), orNull(u.Online.Date), orNull(u.OnlineImage),
		id); err != nil {
		return fmt.Errorf("adopt: %w", err)
	}
	if err := MarkShort(ctx, tx, id); err != nil {
		return err
	}
	for _, s := range u.Inside {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO video_subtitles (video_id, stream, lang, title, forced, file) VALUES (?, ?, ?, ?, ?, ?)`,
			id, *s.Stream, s.Lang, s.Title, s.Forced, s.File); err != nil {
			return fmt.Errorf("adopt: %w", err)
		}
	}
	for _, s := range u.Auto {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO auto_subtitles (video_id, lang, translated_from, model, fingerprint, file, made_at)
			SELECT ?, ?, ?, ?, fingerprint, ?, ? FROM videos WHERE id = ?`,
			id, s.Lang, s.TranslatedFrom, s.Model, s.File, s.MadeAt, id); err != nil {
			return fmt.Errorf("adopt: %w", err)
		}
	}
	for _, a := range u.Audio {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO video_audio (video_id, stream, lang, title, codec, channels, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			id, a.Stream, a.Lang, a.Title, a.Codec, a.Channels, a.Default); err != nil {
			return fmt.Errorf("adopt: %w", err)
		}
	}
	return askWhatIsLeft(ctx, tx, id, u, now)
}

// askWhatIsLeft saves the jobs done and asks for the others. The file next to the
// video is always read again: it takes an instant, is not in the folder and may
// have changed. A video to read again asks for no more, because reading it asks
// for all the rest.
func askWhatIsLeft(ctx context.Context, tx *sql.Tx, id int64, u *content.Reused, now time.Time) error {
	if err := jobs.Enqueue(ctx, tx, id, jobs.Details, false, now); err != nil {
		return err
	}
	if !u.Finished(string(jobs.Probe)) {
		for _, k := range []jobs.Kind{jobs.Probe, jobs.Online} {
			if err := jobs.Enqueue(ctx, tx, id, k, false, now); err != nil {
				return err
			}
		}
		return nil
	}
	for _, k := range []jobs.Kind{jobs.Probe, jobs.Online, jobs.Cover, jobs.Preview, jobs.Clip, jobs.Tracks, jobs.Convert} {
		var err error
		if u.Finished(string(k)) {
			err = jobs.MarkDone(ctx, tx, id, k, now)
		} else {
			err = jobs.Enqueue(ctx, tx, id, k, false, now)
		}
		if err != nil {
			return err
		}
	}
	return nil
}
