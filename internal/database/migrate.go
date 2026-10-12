package database

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"path"
	"strconv"
	"strings"
)

// migrationFiles holds the database schema, one numbered file per change.
// This folder is the only place where the schema is written down.
//
//go:embed migrations/*.sql
var migrationFiles embed.FS

// ErrBadMigrations means the migration files themselves are wrong:
// a bad name, a missing number or a number used twice.
var ErrBadMigrations = errors.New("bad migration files")

// ErrDatabaseTooNew means the database was changed by a newer FranzPLAY.
// Running an older program on it could damage the data, so it refuses.
var ErrDatabaseTooNew = errors.New("database is newer than this FranzPLAY")

// migration is one change to the database schema.
type migration struct {
	version int    // 1, 2, 3… applied in this order
	name    string // file name, for messages
	sql     string
}

// loadMigrations reads every NNNN_description.sql file in fsys and returns
// them in order. Numbers must start at 1 and have no gaps, so a missing
// file is caught here and not discovered later on someone's server.
func loadMigrations(fsys fs.FS) ([]migration, error) {
	names, err := fs.Glob(fsys, "*.sql")
	if err != nil {
		return nil, fmt.Errorf("list migrations: %w", err)
	}
	// fs.Glob returns names sorted, and zero-padded numbers sort correctly.
	migrations := make([]migration, 0, len(names))
	for i, name := range names {
		version, err := migrationVersion(name)
		if err != nil {
			return nil, err
		}
		if version != i+1 {
			return nil, fmt.Errorf("%w: %s should have number %04d", ErrBadMigrations, name, i+1)
		}
		body, err := fs.ReadFile(fsys, name)
		if err != nil {
			return nil, fmt.Errorf("read migration %s: %w", name, err)
		}
		migrations = append(migrations, migration{version: version, name: name, sql: string(body)})
	}
	return migrations, nil
}

// migrationVersion extracts 12 from "0012_add_likes.sql".
func migrationVersion(name string) (int, error) {
	number, description, ok := strings.Cut(strings.TrimSuffix(path.Base(name), ".sql"), "_")
	if !ok || len(number) != 4 || description == "" {
		return 0, fmt.Errorf("%w: %q is not named like 0001_description.sql", ErrBadMigrations, name)
	}
	version, err := strconv.Atoi(number)
	if err != nil || version < 1 {
		return 0, fmt.Errorf("%w: %q does not start with a number from 0001", ErrBadMigrations, name)
	}
	return version, nil
}

// pendingMigrations returns the migrations a database at version current
// still needs. It is a pure decision: no database involved.
func pendingMigrations(current int, all []migration) ([]migration, error) {
	if current < 0 {
		return nil, fmt.Errorf("%w: schema version %d is negative", ErrBadMigrations, current)
	}
	if current > len(all) {
		return nil, fmt.Errorf("%w: database is at version %d, this program knows up to %d",
			ErrDatabaseTooNew, current, len(all))
	}
	return all[current:], nil
}

// migrate brings the database schema up to date. Each migration runs in its
// own transaction together with the new version number, so a migration is
// either fully applied or not at all.
func migrate(ctx context.Context, db *sql.DB, all []migration) error {
	var current int
	if err := db.QueryRowContext(ctx, "PRAGMA user_version").Scan(&current); err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	pending, err := pendingMigrations(current, all)
	if err != nil {
		return err
	}
	for _, m := range pending {
		if err := apply(ctx, db, m); err != nil {
			return err
		}
	}
	return nil
}

// apply runs one migration and records its version, all in one transaction.
func apply(ctx context.Context, db *sql.DB, m migration) (err error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("migration %s: begin: %w", m.name, err)
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, rollback(tx))
		}
	}()

	if _, err := tx.ExecContext(ctx, m.sql); err != nil {
		return fmt.Errorf("migration %s: %w", m.name, err)
	}
	// PRAGMA does not accept "?" parameters; version is an int we produced, never user input.
	if _, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", m.version)); err != nil {
		return fmt.Errorf("migration %s: set schema version: %w", m.name, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("migration %s: commit: %w", m.name, err)
	}
	return nil
}

// rollback undoes a failed transaction. sql.ErrTxDone means it is already over.
func rollback(tx *sql.Tx) error {
	if err := tx.Rollback(); err != nil && !errors.Is(err, sql.ErrTxDone) {
		return fmt.Errorf("rollback: %w", err)
	}
	return nil
}
