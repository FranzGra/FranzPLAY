package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func discardLogs() *slog.Logger { return slog.New(slog.DiscardHandler) }

// backupFixture is a database with one user, and its empty folder of copies.
func backupFixture(t *testing.T) (db *sql.DB, dataDir, dir string) {
	t.Helper()
	dataDir, dir = t.TempDir(), filepath.Join(t.TempDir(), "database")
	db, err := Open(context.Background(), dataDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil && !errors.Is(err, sql.ErrConnDone) {
			t.Error(err)
		}
	})
	if _, err := db.Exec(`INSERT INTO users (name, password_hash, role, created_at) VALUES ('franz', 'x', 'admin', 1)`); err != nil {
		t.Fatal(err)
	}
	return db, dataDir, dir
}

func makeCopy(t *testing.T, db *sql.DB, dir, name string) {
	t.Helper()
	if err := Backup(context.Background(), db, dir, name); err != nil {
		t.Fatal(err)
	}
}

// dropDatabase closes it and deletes all its files, as a lost disk does.
func dropDatabase(t *testing.T, db *sql.DB, dataDir string) {
	t.Helper()
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	for _, end := range []string{"", "-wal", "-shm"} {
		if err := os.Remove(filepath.Join(dataDir, FileName+end)); err != nil && !errors.Is(err, fs.ErrNotExist) {
			t.Fatal(err)
		}
	}
}

func usersIn(t *testing.T, dataDir string) (count int) {
	t.Helper()
	db, err := Open(context.Background(), dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	}()
	if err := db.QueryRow(`SELECT count(*) FROM users`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func TestBackupNameHasTheDateOfFranz(t *testing.T) {
	if got := BackupFile(time.Date(2026, 3, 9, 1, 0, 0, 0, time.UTC)); got != "franzplay_09-03-2026.db" {
		t.Errorf("name = %q", got)
	}
}

func TestBackupIsForThisUserAlone(t *testing.T) {
	db, _, dir := backupFixture(t)
	makeCopy(t, db, dir, "franzplay_01-11-2026.db")
	info, err := os.Stat(filepath.Join(dir, "franzplay_01-11-2026.db"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("mode = %o", info.Mode().Perm())
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 {
		t.Errorf("folder holds %d files, %v", len(entries), err)
	}
}

func TestNextBackupIsAtNight(t *testing.T) {
	at := func(day, hour, minute int) time.Time { return time.Date(2026, 11, day, hour, minute, 0, 0, time.UTC) }
	for now, want := range map[time.Time]time.Time{
		at(1, 3, 59):  at(1, 4, 0),
		at(1, 4, 0):   at(2, 4, 0),
		at(1, 23, 10): at(2, 4, 0),
	} {
		if got := nextBackup(now); !got.Equal(want) {
			t.Errorf("after %v: %v, want %v", now, got, want)
		}
	}
}

func TestOldBackupsGoAndOnlyThose(t *testing.T) {
	dir := t.TempDir()
	var names []string
	// Over two months: the order is of the dates, not of the names.
	for day := range 9 {
		names = append(names, BackupFile(time.Date(2026, 10, 28, 0, 0, 0, 0, time.UTC).AddDate(0, 0, day)))
	}
	others := []string{"franzplay_prima-del-trasferimento_01-11-2026.db", "appunti.txt", "franzplay_31-02-2026.db", "franzplay_2026-11-01.db"}
	for _, name := range append(append([]string{}, names...), others...) {
		if err := os.WriteFile(filepath.Join(dir, name), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := RemoveOldBackups(context.Background(), dir); err != nil {
		t.Fatal(err)
	}
	for i, name := range names {
		_, err := os.Stat(filepath.Join(dir, name))
		if gone := errors.Is(err, fs.ErrNotExist); gone != (i < 2) {
			t.Errorf("%s: gone = %v", name, gone)
		}
	}
	for _, name := range others {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Errorf("%s went: %v", name, err)
		}
	}
}

func TestRunBackupsCopiesAtStartIfMissing(t *testing.T) {
	db, _, dir := backupFixture(t)
	now := func() time.Time { return time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC) }
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		RunBackups(ctx, db, dir, now, discardLogs())
	}()
	deadline := time.Now().Add(10 * time.Second)
	for {
		if _, err := os.Stat(filepath.Join(dir, "franzplay_01-11-2026.db")); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("no copy at start")
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	<-done
}

func TestRestoreUsesTheMostRecentGoodCopy(t *testing.T) {
	db, dataDir, dir := backupFixture(t)
	makeCopy(t, db, dir, "franzplay_30-10-2026.db")
	if _, err := db.Exec(`INSERT INTO users (name, password_hash, role, created_at) VALUES ('anna', 'x', 'admin', 1)`); err != nil {
		t.Fatal(err)
	}
	makeCopy(t, db, dir, "franzplay_31-10-2026.db")
	// Damaged, and more recent.
	broken := filepath.Join(dir, "franzplay_01-11-2026.db")
	if err := os.WriteFile(broken, []byte("non è un database, ma ci assomiglia poco"), 0o600); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(dir, "franzplay_31-10-2026.db"))
	if err != nil {
		t.Fatal(err)
	}
	dropDatabase(t, db, dataDir)

	restored, err := RestoreIfMissing(context.Background(), dataDir, dir, discardLogs())
	if err != nil || !restored {
		t.Fatalf("restored = %v, %v", restored, err)
	}
	if got := usersIn(t, dataDir); got != 2 {
		t.Errorf("%d users, want the 2 of the most recent good copy", got)
	}
	after, err := os.ReadFile(filepath.Join(dir, "franzplay_31-10-2026.db"))
	if err != nil || string(after) != string(before) {
		t.Errorf("the copy changed: %v", err)
	}
	entries, err := os.ReadDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if filepath.Ext(e.Name()) != ".db" && e.Name()[0] == '.' && e.Name() != restoreMarkFile {
			t.Errorf("left behind: %s", e.Name())
		}
	}
	if _, marked := RestoreMark(dataDir); !marked {
		t.Error("nothing says the database came from a copy")
	}
}

func TestRestoreWithADatabaseThereDoesNothing(t *testing.T) {
	db, dataDir, dir := backupFixture(t)
	makeCopy(t, db, dir, "franzplay_31-10-2026.db")
	restored, err := RestoreIfMissing(context.Background(), dataDir, dir, discardLogs())
	if err != nil || restored {
		t.Errorf("restored = %v, %v", restored, err)
	}
}

func TestRestoreWithNoCopiesIsANewStart(t *testing.T) {
	dataDir := t.TempDir()
	restored, err := RestoreIfMissing(context.Background(), dataDir, filepath.Join(dataDir, "database"), discardLogs())
	if err != nil || restored {
		t.Errorf("restored = %v, %v", restored, err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, FileName)); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("a database appeared: %v", err)
	}
}

func TestRestoreRefusesACopyTooNewAndTouchesNothing(t *testing.T) {
	db, dataDir, dir := backupFixture(t)
	if _, err := db.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, 9999)); err != nil {
		t.Fatal(err)
	}
	makeCopy(t, db, dir, "franzplay_31-10-2026.db")
	if _, err := db.Exec(`PRAGMA user_version = 1`); err != nil {
		t.Fatal(err)
	}
	makeCopy(t, db, dir, "franzplay_30-10-2026.db")
	dropDatabase(t, db, dataDir)
	before, err := os.ReadFile(filepath.Join(dir, "franzplay_31-10-2026.db"))
	if err != nil {
		t.Fatal(err)
	}

	restored, err := RestoreIfMissing(context.Background(), dataDir, dir, discardLogs())
	if !errors.Is(err, ErrBackupTooNew) || restored {
		t.Fatalf("restored = %v, %v", restored, err)
	}
	entries, err := os.ReadDir(dataDir)
	if err != nil || len(entries) != 0 {
		t.Errorf("data folder holds %d files, %v", len(entries), err)
	}
	after, err := os.ReadFile(filepath.Join(dir, "franzplay_31-10-2026.db"))
	if err != nil || string(after) != string(before) {
		t.Errorf("the copy changed: %v", err)
	}
}

func TestRestoreWithOnlyDamagedCopiesStops(t *testing.T) {
	dataDir, dir := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "franzplay_31-10-2026.db"), []byte("niente di buono, davvero"), 0o600); err != nil {
		t.Fatal(err)
	}
	// An empty file is a database for SQLite, and it is not ours.
	if err := os.WriteFile(filepath.Join(dir, "franzplay_30-10-2026.db"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	restored, err := RestoreIfMissing(context.Background(), dataDir, dir, discardLogs())
	if !errors.Is(err, ErrNoGoodBackup) || restored {
		t.Errorf("restored = %v, %v", restored, err)
	}
	if entries, err := os.ReadDir(dataDir); err != nil || len(entries) != 0 {
		t.Errorf("data folder holds %d files, %v", len(entries), err)
	}
}

func TestRestoreSetsAsideAnOldJournal(t *testing.T) {
	db, dataDir, dir := backupFixture(t)
	makeCopy(t, db, dir, "franzplay_31-10-2026.db")
	dropDatabase(t, db, dataDir)
	wal := filepath.Join(dataDir, FileName+"-wal")
	if err := os.WriteFile(wal, []byte("rimasto"), 0o600); err != nil {
		t.Fatal(err)
	}
	if restored, err := RestoreIfMissing(context.Background(), dataDir, dir, discardLogs()); err != nil || !restored {
		t.Fatalf("restored = %v, %v", restored, err)
	}
	if got, err := os.ReadFile(wal + ".orfano"); err != nil || string(got) != "rimasto" {
		t.Errorf("set aside: %q, %v", got, err)
	}
	if got := usersIn(t, dataDir); got != 1 {
		t.Errorf("%d users", got)
	}
}

func TestOpenToReadChangesNothing(t *testing.T) {
	db, dataDir, _ := backupFixture(t)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(dataDir, FileName))
	if err != nil {
		t.Fatal(err)
	}
	read, err := OpenToRead(context.Background(), dataDir, 1)
	if err != nil {
		t.Fatal(err)
	}
	var count int
	if err := read.QueryRow(`SELECT count(*) FROM users`).Scan(&count); err != nil || count != 1 {
		t.Errorf("%d users, %v", count, err)
	}
	if _, err := read.Exec(`DELETE FROM users`); err == nil {
		t.Error("it can write")
	}
	if err := read.Close(); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(filepath.Join(dataDir, FileName))
	if err != nil || string(after) != string(before) {
		t.Errorf("the file changed: %v", err)
	}
	entries, err := os.ReadDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.Name() != FileName {
			t.Errorf("%s appeared", e.Name())
		}
	}
	if _, err := OpenToRead(context.Background(), dataDir, 99999); err == nil {
		t.Error("too old a database accepted")
	}
}
