// Package online asks sources on the internet about the videos: covers,
// titles and who made them. Every source is off until the administrator
// turns it on, and FranzPLAY works the same without any (no internet
// needed). Only the code of a video is sent, never anything about the
// people who use FranzPLAY.
package online

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// Sources says which sources on the internet the administrator turned on.
type Sources struct {
	YouTube bool `json:"youtube"` // videos saved from YouTube, by the code in their file name
}

// The keys of the settings table.
const keyYouTube = "online.youtube"

// querier is what loadSources and saveSources need: a database or a
// transaction.
type querier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// loadSources reads which sources are on. A source never set is off.
func loadSources(ctx context.Context, db querier) (Sources, error) {
	var value string
	err := db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, keyYouTube).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return Sources{}, nil
	}
	if err != nil {
		return Sources{}, fmt.Errorf("read online sources: %w", err)
	}
	return Sources{YouTube: value == "on"}, nil
}

// saveSources writes which sources are on.
func saveSources(ctx context.Context, db querier, s Sources) error {
	value := "off"
	if s.YouTube {
		value = "on"
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value`, keyYouTube, value); err != nil {
		return fmt.Errorf("save online sources: %w", err)
	}
	return nil
}
