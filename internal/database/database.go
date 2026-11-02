// Package database opens FranzPLAY's SQLite database and keeps its schema
// up to date. It is the only package that knows where the database lives.
package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite" // SQLite driver written in pure Go: no C compiler needed.
)

// MaxConnections is how many queries can run at the same time: one per
// core of a Raspberry Pi 4. Each connection keeps a small cache (about 2 MB).
const MaxConnections = 4

// FileName is the database file inside the data folder.
const FileName = "franzplay.db"

// ErrBadPath means the database path cannot be used.
var ErrBadPath = errors.New("path must not contain \"?\"")

// Open opens (or creates) the database in dataDir and applies any pending
// migrations. The caller must Close the returned database.
func Open(ctx context.Context, dataDir string) (*sql.DB, error) {
	return open(ctx, filepath.Join(dataDir, FileName), migrationsFS())
}

// OpenToRead opens the database in dataDir without changing anything, not even the
// files SQLite keeps next to it, and without applying migrations. It refuses a
// database older than minimum or newer than this program. What a stop by power cut
// left in the journal is not seen: the caller may say so with HasJournal.
func OpenToRead(ctx context.Context, dataDir string, minimum int) (_ *sql.DB, err error) {
	all, err := loadMigrations(migrationsFS())
	if err != nil {
		return nil, err
	}
	file := filepath.Join(dataDir, FileName)
	if strings.Contains(file, "?") {
		return nil, fmt.Errorf("database path %q: %w", file, ErrBadPath)
	}
	address, err := readOnlyAddress(file)
	if err != nil {
		return nil, fmt.Errorf("open database %q: %w", file, err)
	}
	db, err := sql.Open("sqlite", address)
	if err != nil {
		return nil, fmt.Errorf("open database %q: %w", file, err)
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, db.Close())
		}
	}()
	var version int
	if err := db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&version); err != nil {
		return nil, fmt.Errorf("open database %q: %w", file, err)
	}
	if version > len(all) {
		return nil, fmt.Errorf("%w: it is at version %d, this program knows up to %d", ErrDatabaseTooNew, version, len(all))
	}
	if version < minimum {
		return nil, fmt.Errorf("database %q is at version %d: start this FranzPLAY once, stop it, and run this again", file, version)
	}
	return db, nil
}

// readOnlyAddress is the address that opens a database file only to read, leaving
// no file next to it. It works with a relative path too.
func readOnlyAddress(file string) (string, error) {
	abs, err := filepath.Abs(file)
	if err != nil {
		return "", err
	}
	return fileURI(filepath.ToSlash(abs)), nil
}

// fileURI writes an absolute path with forward slashes as SQLite wants it. A
// Windows path, C:/data, needs the third slash too: file:///C:/data.
func fileURI(path string) string {
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	address := url.URL{Scheme: "file", Path: path, RawQuery: "mode=ro&immutable=1"}
	return address.String()
}

// HasJournal reports whether changes wait next to the database: it was not closed
// properly.
func HasJournal(dataDir string) bool {
	info, err := os.Stat(filepath.Join(dataDir, FileName+"-wal"))
	return err == nil && info.Size() > 0
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
	// A few connections, so people can read at the same time: a jump in a
	// video must not wait behind someone else's Home page. SQLite still lets
	// only one of them write at a time (see _txlock in dsn). Every connection
	// gets the settings in dsn, and idle ones are kept, not opened again.
	db.SetMaxOpenConns(MaxConnections)
	db.SetMaxIdleConns(MaxConnections)

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
//   - busy_timeout: a write waits up to 30 seconds for another one to end,
//     instead of failing. Reads never wait for writes (WAL).
//   - txlock immediate: a transaction takes the write lock when it begins.
//     Without it, two transactions that read and then write could block
//     each other, and one would fail at once with "database is locked".
//
// The driver splits the name at the first "?", so a path containing one is refused.
func dsn(file string) (string, error) {
	if strings.Contains(file, "?") {
		return "", fmt.Errorf("database path %q: %w", file, ErrBadPath)
	}
	return file + "?_foreign_keys=1&_journal_mode=WAL&_synchronous=NORMAL&_busy_timeout=30000&_txlock=immediate", nil
}
