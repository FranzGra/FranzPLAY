package database

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"testing/fstest"
	"time"
)

func schemaVersion(t *testing.T, db *sql.DB) int {
	t.Helper()
	var v int
	if err := db.QueryRowContext(context.Background(), "PRAGMA user_version").Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func openTest(t *testing.T, file string, migrations fstest.MapFS) *sql.DB {
	t.Helper()
	db, err := open(context.Background(), file, migrations)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	return db
}

func sqlFiles(pairs ...string) fstest.MapFS {
	fsys := fstest.MapFS{}
	for i := 0; i < len(pairs); i += 2 {
		fsys[pairs[i]] = &fstest.MapFile{Data: []byte(pairs[i+1])}
	}
	return fsys
}

func TestOpenCreatesTheDatabaseWithTheRealSchema(t *testing.T) {
	dir := t.TempDir()
	db, err := Open(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})

	if _, err := os.Stat(filepath.Join(dir, FileName)); err != nil {
		t.Fatalf("database file not created: %v", err)
	}
	all, err := loadMigrations(migrationsFS())
	if err != nil {
		t.Fatal(err)
	}
	if got := schemaVersion(t, db); got != len(all) {
		t.Errorf("schema version = %d, want %d", got, len(all))
	}
	if _, err := db.Exec("INSERT INTO settings (key, value) VALUES ('k', 'v')"); err != nil {
		t.Errorf("settings table not usable: %v", err)
	}
}

func TestOpenAppliesSettings(t *testing.T) {
	db := openTest(t, filepath.Join(t.TempDir(), "x.db"), sqlFiles("0001_a.sql", "CREATE TABLE a (id INTEGER);"))
	checks := map[string]string{
		"PRAGMA foreign_keys": "1",
		"PRAGMA journal_mode": "wal",
		"PRAGMA synchronous":  "1",
		"PRAGMA busy_timeout": "30000",
	}
	// Every connection must have the settings, not only the first one.
	ctx := context.Background()
	conns := make([]*sql.Conn, MaxConnections)
	for i := range conns {
		c, err := db.Conn(ctx)
		if err != nil {
			t.Fatal(err)
		}
		conns[i] = c
	}
	for i, c := range conns {
		for pragma, want := range checks {
			var got string
			if err := c.QueryRowContext(ctx, pragma).Scan(&got); err != nil {
				t.Fatalf("connection %d, %s: %v", i, pragma, err)
			}
			if got != want {
				t.Errorf("connection %d: %s = %s, want %s", i, pragma, got, want)
			}
		}
	}
	for _, c := range conns {
		if err := c.Close(); err != nil {
			t.Error(err)
		}
	}
}

// TestReadsDoNotWaitForAWrite: while a long write is still open (a library
// scan, say), someone jumping in a video can still read.
func TestReadsDoNotWaitForAWrite(t *testing.T) {
	db := openTest(t, filepath.Join(t.TempDir(), "x.db"),
		sqlFiles("0001_a.sql", "CREATE TABLE a (id INTEGER); INSERT INTO a VALUES (1);"))
	ctx := context.Background()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO a VALUES (2)"); err != nil {
		t.Fatal(err)
	}

	readCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	var n int
	if err := db.QueryRowContext(readCtx, "SELECT count(*) FROM a").Scan(&n); err != nil {
		t.Fatalf("read during a write: %v", err)
	}
	if n != 1 {
		t.Errorf("read %d rows, want 1: the write is not finished yet", n)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

// TestWritesTakeTurns: transactions that read and then write, started at
// the same moment, all succeed one after the other instead of failing with
// "database is locked".
func TestWritesTakeTurns(t *testing.T) {
	db := openTest(t, filepath.Join(t.TempDir(), "x.db"),
		sqlFiles("0001_a.sql", "CREATE TABLE counter (n INTEGER); INSERT INTO counter VALUES (0);"))
	ctx := context.Background()
	const writers = 2 * MaxConnections
	errs := make(chan error, writers)
	var wg sync.WaitGroup
	for range writers {
		wg.Go(func() {
			errs <- func() (err error) {
				tx, err := db.BeginTx(ctx, nil)
				if err != nil {
					return err
				}
				defer func() {
					if err != nil {
						err = errors.Join(err, tx.Rollback())
					}
				}()
				var n int
				if err := tx.QueryRowContext(ctx, "SELECT n FROM counter").Scan(&n); err != nil {
					return err
				}
				time.Sleep(5 * time.Millisecond) // let the others try in the meantime
				if _, err := tx.ExecContext(ctx, "UPDATE counter SET n = ?", n+1); err != nil {
					return err
				}
				return tx.Commit()
			}()
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Errorf("write failed: %v", err)
		}
	}
	var n int
	if err := db.QueryRow("SELECT n FROM counter").Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != writers {
		t.Errorf("counter = %d, want %d: a write was lost", n, writers)
	}
}

func TestOpenAgainAppliesOnlyNewMigrations(t *testing.T) {
	file := filepath.Join(t.TempDir(), "x.db")
	first := sqlFiles("0001_a.sql", "CREATE TABLE a (id INTEGER);")
	db, err := open(context.Background(), file, first)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO a VALUES (1)"); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	// A newer program adds a second migration. The first must not run again,
	// otherwise "CREATE TABLE a" would fail and the row would be lost.
	second := sqlFiles(
		"0001_a.sql", "CREATE TABLE a (id INTEGER);",
		"0002_b.sql", "CREATE TABLE b (id INTEGER);",
	)
	db = openTest(t, file, second)
	if got := schemaVersion(t, db); got != 2 {
		t.Errorf("schema version = %d, want 2", got)
	}
	var rows int
	if err := db.QueryRow("SELECT count(*) FROM a").Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Errorf("table a has %d rows, want 1", rows)
	}
}

func TestFailedMigrationLeavesNothingHalfDone(t *testing.T) {
	file := filepath.Join(t.TempDir(), "x.db")
	broken := sqlFiles(
		"0001_a.sql", "CREATE TABLE a (id INTEGER);",
		"0002_b.sql", "CREATE TABLE b (id INTEGER); THIS IS NOT SQL;",
	)
	if _, err := open(context.Background(), file, broken); err == nil {
		t.Fatal("open succeeded with a broken migration")
	}

	db := openTest(t, file, sqlFiles("0001_a.sql", "CREATE TABLE a (id INTEGER);"))
	if got := schemaVersion(t, db); got != 1 {
		t.Errorf("schema version = %d, want 1 (only the good migration)", got)
	}
	var tables int
	if err := db.QueryRow("SELECT count(*) FROM sqlite_schema WHERE name = 'b'").Scan(&tables); err != nil {
		t.Fatal(err)
	}
	if tables != 0 {
		t.Error("table b exists although its migration failed")
	}
}

func TestOpenRefusesADatabaseFromANewerProgram(t *testing.T) {
	file := filepath.Join(t.TempDir(), "x.db")
	newer := sqlFiles("0001_a.sql", "SELECT 1;", "0002_b.sql", "SELECT 1;")
	db, err := open(context.Background(), file, newer)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	_, err = open(context.Background(), file, sqlFiles("0001_a.sql", "SELECT 1;"))
	if !errors.Is(err, ErrDatabaseTooNew) {
		t.Errorf("error = %v, want ErrDatabaseTooNew", err)
	}
}

func TestOpenRefusesBadPath(t *testing.T) {
	_, err := open(context.Background(), filepath.Join(t.TempDir(), "what?.db"), sqlFiles("0001_a.sql", "SELECT 1;"))
	if !errors.Is(err, ErrBadPath) {
		t.Errorf("error = %v, want ErrBadPath", err)
	}
}

func TestOpenWorksWithSpacesInPath(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "my videos data")
	if err := os.Mkdir(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	openTest(t, filepath.Join(dir, "x.db"), sqlFiles("0001_a.sql", "SELECT 1;"))
	if _, err := os.Stat(filepath.Join(dir, "x.db")); err != nil {
		t.Errorf("database not created where expected: %v", err)
	}
}
