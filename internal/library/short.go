package library

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
)

// keyMinDuration is the settings row with the shortest a video of the
// video folders may last, in seconds, to be shown. Missing means no
// minimum: a new FranzPLAY shows every video, even a very short one.
const keyMinDuration = "library.min_duration"

// MaxMinDuration is the highest minimum the administrator may choose: ten
// minutes is already far more than any preview or leftover clip.
const MaxMinDuration = 600

var errBadMinDuration = fmt.Errorf("the minimum must be between 0 and %d seconds", MaxMinDuration)

// checkMinDuration says whether seconds is a minimum the administrator may
// choose; 0 turns the minimum off.
func checkMinDuration(seconds int) error {
	if seconds < 0 || seconds > MaxMinDuration {
		return errBadMinDuration
	}
	return nil
}

// markShort is the one rule that says which videos are too short: the
// ones of the video folders whose length is known and below the minimum.
// Uploaded videos never are: whoever uploads a short video wants it seen.
const markShort = `
	UPDATE videos SET too_short = coalesce(uploaded_by IS NULL AND duration <
		(SELECT CAST(value AS INTEGER) FROM settings WHERE key = '` + keyMinDuration + `'), 0)`

// execer runs a statement: a database or a transaction.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// MarkShort decides again whether one video is too short to be shown. It
// is called when its length becomes known.
func MarkShort(ctx context.Context, db execer, videoID int64) error {
	if _, err := db.ExecContext(ctx, markShort+` WHERE id = ?`, videoID); err != nil {
		return fmt.Errorf("check length of video %d: %w", videoID, err)
	}
	return nil
}

// minDuration returns the minimum length in seconds, 0 when there is none.
func (s store) minDuration(ctx context.Context) (int, error) {
	var value string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, keyMinDuration).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("read minimum length: %w", err)
	}
	n, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("read minimum length %q: %w", value, err)
	}
	return n, nil
}

// setMinDuration saves the minimum length and decides again, for every
// video, whether it is too short. Both happen together or not at all.
func (s store) setMinDuration(ctx context.Context, seconds int) (err error) {
	if err := checkMinDuration(seconds); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("save minimum length: %w", err)
	}
	defer func() { err = finish(tx, err) }()

	if seconds == 0 {
		_, err = tx.ExecContext(ctx, `DELETE FROM settings WHERE key = ?`, keyMinDuration)
	} else {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO settings (key, value) VALUES (?, ?)
			ON CONFLICT (key) DO UPDATE SET value = excluded.value`, keyMinDuration, strconv.Itoa(seconds))
	}
	if err != nil {
		return fmt.Errorf("save minimum length: %w", err)
	}
	if _, err := tx.ExecContext(ctx, markShort); err != nil {
		return fmt.Errorf("check length of every video: %w", err)
	}
	return nil
}

// tooShort counts the videos on the disk left out because they are too short.
func (s store) tooShort(ctx context.Context) (int, error) {
	var n int
	if err := s.db.QueryRowContext(ctx,
		`SELECT count(*) FROM videos WHERE too_short AND missing_since IS NULL`).Scan(&n); err != nil {
		return 0, fmt.Errorf("count videos too short: %w", err)
	}
	return n, nil
}
