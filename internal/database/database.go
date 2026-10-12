// Package database opens FranzPLAY's SQLite database and keeps its schema
// up to date. It is the only package that knows where the database lives.
package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite" // SQLite driver written in pure Go: no C compiler needed.
)

// FileName is the database file inside the data folder.
const FileName = "franzplay.db"

// ErrBadPath means the database path cannot be used.
var ErrBadPath = errors.New("path must not contain \"?\"")

// Open opens (or creates) the database in dataDir and applies any pending
// migrations. The caller must Close the returned database.
func Open(ctx context.Context, dataDir string) (*sql.DB, error) {
	return open(ctx, filepath.Join(dataDir, FileName), migrationsFS())
}

func migrationsFS() fs.FS {
	sub, err := fs.Sub(migrationFiles, "migrations")
	if err != nil {
		// The folder is embedded at build time, so this cannot fail at run time.
		panic(fmt.Sprintf("embedded migrations: %v", err))
	}
	return sub
}

func open(ctx context.Context, file string, migrationsDir fs.FS) (*sql.DB, error) {
	all, err := loadMigrations(migrationsDir)
	if err != nil {
		return nil, err
	}

	name, err := dsn(file)
	if err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", name)
	if err != nil {
		return nil, fmt.Errorf("open database %q: %w", file, err)
	}
	// One connection at a time: simple, and SQLite allows only one writer anyway.
	// It also makes every connection setting below apply to the whole program.
	db.SetMaxOpenConns(1)

	if err := db.PingContext(ctx); err != nil {
		return nil, errors.Join(fmt.Errorf("open database %q: %w", file, err), db.Close())
	}
	if err := migrate(ctx, db, all); err != nil {
		return nil, errors.Join(fmt.Errorf("update database %q: %w", file, err), db.Close())
	}
	return db, nil
}

// dsn builds the name the SQLite driver understands: the file path, then
// the settings FranzPLAY relies on:
//   - foreign_keys: SQLite ignores links between tables unless asked.
//   - journal_mode WAL: safer against power cuts, readers do not block the writer.
//   - synchronous NORMAL: the safe and fast companion of WAL.
//   - busy_timeout: wait up to 5 seconds instead of failing when the file is busy.
//
// The driver splits the name at the first "?", so a path containing one is refused.
func dsn(file string) (string, error) {
	if strings.Contains(file, "?") {
		return "", fmt.Errorf("database path %q: %w", file, ErrBadPath)
	}
	return file + "?_foreign_keys=1&_journal_mode=WAL&_synchronous=NORMAL&_busy_timeout=5000", nil
}
