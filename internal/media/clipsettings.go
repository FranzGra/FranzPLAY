package media

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"

	"github.com/FranzGra/FranzPLAY/internal/video"
)

// The administrator chooses, for the whole site, where the clips start and
// how long they last. Missing rows mean the clip FranzPLAY always made:
// automatic start, video.DefaultClipSeconds. The choice is used by the
// clips made from now on: the ones already made stay as they are.
const (
	keyClipStartPercent = "clips.start_percent"
	keyClipSeconds      = "clips.seconds"
)

// ClipSettings is the site's choice for the clips.
type ClipSettings struct {
	// StartPercent is where every clip starts, in percent of the video;
	// 0 is automatic, a few moments spread over the video.
	StartPercent int `json:"startPercent"`
	// Seconds is how long every clip lasts.
	Seconds int `json:"seconds"`
}

// ErrBadClipSettings is a choice outside what the clips can be.
var ErrBadClipSettings = fmt.Errorf("the clip starts between 0 and %d%% of the video and lasts between %d and %d seconds",
	video.MaxClipStartPercent, video.MinClipSeconds, video.MaxClipSeconds)

// Check says whether s can be saved.
func (s ClipSettings) Check() error {
	if s.StartPercent < 0 || s.StartPercent > video.MaxClipStartPercent ||
		s.Seconds < video.MinClipSeconds || s.Seconds > video.MaxClipSeconds {
		return ErrBadClipSettings
	}
	return nil
}

// querier reads one row: a database or a transaction.
type querier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// ReadClipSettings returns the site's choice for the clips.
func ReadClipSettings(ctx context.Context, db querier) (ClipSettings, error) {
	s := ClipSettings{Seconds: video.DefaultClipSeconds}
	for _, f := range []struct {
		key string
		to  *int
	}{{keyClipStartPercent, &s.StartPercent}, {keyClipSeconds, &s.Seconds}} {
		var value string
		err := db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, f.key).Scan(&value)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return ClipSettings{}, fmt.Errorf("read clip settings: %w", err)
		}
		n, err := strconv.Atoi(value)
		if err != nil {
			return ClipSettings{}, fmt.Errorf("read clip setting %s %q: %w", f.key, value, err)
		}
		*f.to = n
	}
	return s, nil
}

// SaveClipSettings saves the site's choice for the clips. The choice
// FranzPLAY makes by itself is saved as no rows at all.
func SaveClipSettings(ctx context.Context, db *sql.DB, s ClipSettings) (err error) {
	if err := s.Check(); err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("save clip settings: %w", err)
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, tx.Rollback())
			return
		}
		err = tx.Commit()
	}()
	for _, f := range []struct {
		key        string
		value, def int
	}{{keyClipStartPercent, s.StartPercent, 0}, {keyClipSeconds, s.Seconds, video.DefaultClipSeconds}} {
		if f.value == f.def {
			_, err = tx.ExecContext(ctx, `DELETE FROM settings WHERE key = ?`, f.key)
		} else {
			_, err = tx.ExecContext(ctx, `INSERT INTO settings (key, value) VALUES (?, ?)
				ON CONFLICT (key) DO UPDATE SET value = excluded.value`, f.key, strconv.Itoa(f.value))
		}
		if err != nil {
			return fmt.Errorf("save clip settings: %w", err)
		}
	}
	return nil
}

// clipPlan is the plan of one video's clip: its own start and length, if
// the administrator chose them, or else the site's.
func clipPlan(site ClipSettings, second, seconds sql.NullInt64) video.ClipPlan {
	p := video.ClipPlan{Second: -1, Percent: site.StartPercent, Seconds: int64(site.Seconds)}
	if second.Valid {
		p.Second = second.Int64
	}
	if seconds.Valid {
		p.Seconds = seconds.Int64
	}
	return p
}
