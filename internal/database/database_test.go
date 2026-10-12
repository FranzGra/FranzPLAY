package database

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"
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
		"PRAGMA busy_timeout": "5000",
	}
	for pragma, want := range checks {
		var got string
		if err := db.QueryRow(pragma).Scan(&got); err != nil {
			t.Fatalf("%s: %v", pragma, err)
		}
		if got != want {
			t.Errorf("%s = %s, want %s", pragma, got, want)
		}
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
