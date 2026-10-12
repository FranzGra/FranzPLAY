// Package online asks sources on the internet about the videos: covers,
// titles and who made them. Every source is off until the administrator
// turns it on, and FranzPLAY works the same without any (no internet
// needed). Only what finds a video is sent (a YouTube code or a film's
// title and year from the file name, or a fingerprint of the file), never
// anything about the people who use FranzPLAY.
package online

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
)

// Sources says which sources on the internet the administrator turned on.
type Sources struct {
	YouTube bool `json:"youtube"` // videos saved from YouTube, by the code in their file name
	TMDB    bool `json:"tmdb"`    // films, by the title and year in their file name
	TPDB    bool `json:"tpdb"`    // ThePornDB: every other video, by a fingerprint of the file
}

// settings is everything saved about the sources. The keys are secrets:
// they never leave the server.
type settings struct {
	Sources
	rules   Rules
	asked   string // the count of today's questions, as saved
	tmdbKey string
	tpdbKey string
}

// The keys of the settings table.
const (
	keyYouTube = "online.youtube"
	keyTMDB    = "online.tmdb"
	keyTMDBKey = "online.tmdb.key"
	keyTPDB    = "online.tpdb"
	keyTPDBKey = "online.tpdb.key"
)

// querier is what the settings need: a database or a transaction.
type querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// loadSettings reads the sources, their keys and the rules. A source
// never set is off; a key never set is "".
func loadSettings(ctx context.Context, db querier) (s settings, err error) {
	s.rules = defaultRules()
	rows, err := db.QueryContext(ctx, `SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?, ?, ?, ?)`,
		keyYouTube, keyTMDB, keyTMDBKey, keyTPDB, keyTPDBKey, keyRules, keyAsked)
	if err != nil {
		return settings{}, fmt.Errorf("read online sources: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return settings{}, fmt.Errorf("read online sources: %w", err)
		}
		switch key {
		case keyYouTube:
			s.YouTube = value == "on"
		case keyTMDB:
			s.TMDB = value == "on"
		case keyTMDBKey:
			s.tmdbKey = value
		case keyTPDB:
			s.TPDB = value == "on"
		case keyTPDBKey:
			s.tpdbKey = value
		case keyRules:
			s.rules = parseRules(value)
		case keyAsked:
			s.asked = value
		}
	}
	if err := rows.Err(); err != nil {
		return settings{}, fmt.Errorf("read online sources: %w", err)
	}
	return s, nil
}

// saveSources writes which sources are on.
func saveSources(ctx context.Context, db querier, s Sources) error {
	for key, on := range map[string]bool{keyYouTube: s.YouTube, keyTMDB: s.TMDB, keyTPDB: s.TPDB} {
		value := "off"
		if on {
			value = "on"
		}
		if err := saveSetting(ctx, db, key, value); err != nil {
			return fmt.Errorf("save online sources: %w", err)
		}
	}
	return nil
}

func saveSetting(ctx context.Context, db querier, key, value string) error {
	_, err := db.ExecContext(ctx, `
		INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

// tmdbKeyShape is what TMDB's keys look like: the short "API key" (32
// hexadecimal characters) or the long "read access token", three pieces
// separated by dots. Anything else is refused before it is sent anywhere.
var tmdbKeyShape = regexp.MustCompile(`^(?:[0-9a-f]{32}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$`)

// validTMDBKey says if a key has the shape of one of TMDB's.
func validTMDBKey(key string) bool {
	return len(key) <= 1024 && tmdbKeyShape.MatchString(key)
}

// tpdbKeyShape is what ThePornDB's keys look like: letters, digits and a
// few signs, like "123|AbC…". Nothing that could break a header.
var tpdbKeyShape = regexp.MustCompile(`^[A-Za-z0-9|._-]{20,200}$`)

// validTPDBKey says if a key has the shape of one of ThePornDB's.
func validTPDBKey(key string) bool {
	return tpdbKeyShape.MatchString(key)
}
