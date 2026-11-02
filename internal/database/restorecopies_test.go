package database

import (
	"context"
	"database/sql"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// emptyDatabase is a database with nothing in it, as a disk lost and started again leaves.
func emptyDatabase(t *testing.T) *sql.DB {
	t.Helper()
	db, err := Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil && !errors.Is(err, sql.ErrConnDone) {
			t.Error(err)
		}
	})
	return db
}

func TestAnEmptyDatabaseIsNotCopiedOverGoodOnes(t *testing.T) {
	db, _, dir := backupFixture(t)
	makeCopy(t, db, dir, "franzplay_01-11-2026.db")
	backupNow(context.Background(), emptyDatabase(t), dir, "franzplay_02-11-2026.db", discardLogs())
	if _, err := os.Stat(filepath.Join(dir, "franzplay_02-11-2026.db")); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("an empty copy was made: %v", err)
	}
	// With nothing better it is made: a new installation has its copy too.
	dir = filepath.Join(t.TempDir(), "database")
	backupNow(context.Background(), emptyDatabase(t), dir, "franzplay_02-11-2026.db", discardLogs())
	if _, err := os.Stat(filepath.Join(dir, "franzplay_02-11-2026.db")); err != nil {
		t.Errorf("the first copy of an empty database: %v", err)
	}
}

func TestRestoreLeavesEmptyCopiesForLast(t *testing.T) {
	db, dataDir, dir := backupFixture(t)
	makeCopy(t, db, dir, "franzplay_01-11-2026.db")
	makeCopy(t, emptyDatabase(t), dir, "franzplay_02-11-2026.db")
	dropDatabase(t, db, dataDir)
	restored, err := RestoreIfMissing(context.Background(), dataDir, dir, discardLogs())
	if err != nil || !restored {
		t.Fatalf("restored %v, %v", restored, err)
	}
	if got := usersIn(t, dataDir); got != 1 {
		t.Errorf("users %d: the empty copy won", got)
	}
}

func TestRestoreUsesAnEmptyCopyWhenThereIsNothingElse(t *testing.T) {
	dataDir, dir := t.TempDir(), filepath.Join(t.TempDir(), "database")
	makeCopy(t, emptyDatabase(t), dir, "franzplay_02-11-2026.db")
	restored, err := RestoreIfMissing(context.Background(), dataDir, dir, discardLogs())
	if err != nil || !restored {
		t.Fatalf("restored %v, %v", restored, err)
	}
	if got := usersIn(t, dataDir); got != 0 {
		t.Errorf("users %d", got)
	}
}

func TestRotationKeepsTheLastCopyWithData(t *testing.T) {
	db, _, dir := backupFixture(t)
	first := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	makeCopy(t, db, dir, BackupFile(first))
	empty := emptyDatabase(t)
	for day := range KeepBackups + 2 {
		makeCopy(t, empty, dir, BackupFile(first.AddDate(0, 0, day+1)))
	}
	if err := RemoveOldBackups(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, BackupFile(first))); err != nil {
		t.Errorf("the only copy with data went: %v", err)
	}
	all, err := listBackups(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != KeepBackups+1 {
		t.Errorf("%d copies: %q", len(all), all)
	}
}

// A stop right after the restore loses nothing: the next start still knows the
// database came from a copy.
func TestAStopAfterARestoreIsNotForgotten(t *testing.T) {
	db, dataDir, dir := backupFixture(t)
	makeCopy(t, db, dir, "franzplay_01-11-2026.db")
	dropDatabase(t, db, dataDir)
	if restored, err := RestoreIfMissing(context.Background(), dataDir, dir, discardLogs()); err != nil || !restored {
		t.Fatalf("restored %v, %v", restored, err)
	}
	restored, err := RestoreIfMissing(context.Background(), dataDir, dir, discardLogs())
	if err != nil || !restored {
		t.Errorf("after a stop: restored %v, %v", restored, err)
	}
	info, err := os.Stat(filepath.Join(dir, "franzplay_01-11-2026.db"))
	if err != nil {
		t.Fatal(err)
	}
	if madeAt, marked := RestoreMark(dataDir); !marked || madeAt.Unix() != info.ModTime().Unix() {
		t.Errorf("mark %v %v, want the time of the copy %v", madeAt, marked, info.ModTime())
	}
	if err := ClearRestoreMark(dataDir); err != nil {
		t.Fatal(err)
	}
	if restored, err := RestoreIfMissing(context.Background(), dataDir, dir, discardLogs()); err != nil || restored {
		t.Errorf("once dealt with: restored %v, %v", restored, err)
	}
}

// A mark left by a restore that stopped before the database appeared means
// nothing for a new start.
func TestAMarkWithNoCopiesIsForgotten(t *testing.T) {
	dataDir := t.TempDir()
	if err := writeRestoreMark(dataDir, time.Unix(5, 0)); err != nil {
		t.Fatal(err)
	}
	restored, err := RestoreIfMissing(context.Background(), dataDir, filepath.Join(t.TempDir(), "database"), discardLogs())
	if err != nil || restored {
		t.Fatalf("restored %v, %v", restored, err)
	}
	if _, marked := RestoreMark(dataDir); marked {
		t.Error("the mark stayed")
	}
}

func TestFileURI(t *testing.T) {
	for path, want := range map[string]string{
		"/data/franzplay.db":       "file:///data/franzplay.db?mode=ro&immutable=1",
		"/con spazi/a#b%c.db":      "file:///con%20spazi/a%23b%25c.db?mode=ro&immutable=1",
		"C:/Dati di Franz/play.db": "file:///C:/Dati%20di%20Franz/play.db?mode=ro&immutable=1",
	} {
		if got := fileURI(path); got != want {
			t.Errorf("%s: %s, want %s", path, got, want)
		}
	}
}

func TestOpenToReadWithARelativePath(t *testing.T) {
	t.Chdir(t.TempDir())
	for _, name := range []string{"dati", "con spazi", "con%25 e #"} {
		if err := os.Mkdir(name, 0o750); err != nil {
			t.Fatal(err)
		}
		db, err := Open(context.Background(), name)
		if err != nil {
			t.Fatal(err)
		}
		if err := db.Close(); err != nil {
			t.Fatal(err)
		}
		read, err := OpenToRead(context.Background(), name, 1)
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		var version int
		if err := read.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil || version == 0 {
			t.Errorf("%s: version %d, %v", name, version, err)
		}
		if err := read.Close(); err != nil {
			t.Error(err)
		}
	}
}
