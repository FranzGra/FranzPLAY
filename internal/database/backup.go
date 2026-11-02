package database

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/safefile"
)

// The safety copies of the database stay in the folder "database" of the content,
// on another disk if there is one. Inside are password hashes, sessions and API
// keys: the folder is for this user alone (0700), and so is every copy (0600).

const (
	// backupDate is how a date is written in the name of a copy: GG-MM-AAAA.
	backupDate = "02-01-2006"
	// KeepBackups is how many copies stay.
	KeepBackups = 7
	// BackupHour is the hour of the night copy, local time: nobody watches and
	// the scans have nothing to do.
	BackupHour = 4
	// unfinishedBackup starts the name of a copy being written.
	unfinishedBackup = ".franzplay-new-"
)

// backupName is the name of a daily copy. Only files named like this are ever
// used or deleted.
var backupName = regexp.MustCompile(`^franzplay_([0-9]{2}-[0-9]{2}-[0-9]{4})\.db$`)

// ErrBackupTooNew means the most recent good copy was made by a newer FranzPLAY.
var ErrBackupTooNew = errors.New("the safety copy of the database is newer than this FranzPLAY")

// ErrNoGoodBackup means there are copies and none can be used.
var ErrNoGoodBackup = errors.New("no safety copy of the database can be used")

// BackupFile is the name of the copy of a day.
func BackupFile(day time.Time) string { return "franzplay_" + day.Format(backupDate) + ".db" }

// nextBackup says when the night copy after now is.
func nextBackup(now time.Time) time.Time {
	next := time.Date(now.Year(), now.Month(), now.Day(), BackupHour, 0, 0, 0, now.Location())
	if !next.After(now) {
		next = time.Date(now.Year(), now.Month(), now.Day()+1, BackupHour, 0, 0, 0, now.Location())
	}
	return next
}

// MakeBackupFolder makes the folder of the copies, for this user alone.
func MakeBackupFolder(dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create folder of the database copies: %w", err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return fmt.Errorf("create folder of the database copies: %w", err)
	}
	return nil
}

// Backup writes a copy of the database in dir with the given name, all or
// nothing: another writer goes on meanwhile, and a copy with that name is replaced
// only when the new one is complete. It returns nothing half done.
func Backup(ctx context.Context, db *sql.DB, dir, name string) (err error) {
	if err := MakeBackupFolder(dir); err != nil {
		return err
	}
	random := make([]byte, 8)
	if _, err := rand.Read(random); err != nil {
		return fmt.Errorf("copy of the database: %w", err)
	}
	// VACUUM INTO wants a file that is not there yet.
	tmp := filepath.Join(dir, unfinishedBackup+hex.EncodeToString(random))
	defer func() {
		if rmErr := os.Remove(tmp); rmErr != nil && !errors.Is(rmErr, fs.ErrNotExist) {
			err = errors.Join(err, rmErr)
		}
	}()
	if _, err := db.ExecContext(ctx, `VACUUM INTO ?`, tmp); err != nil {
		return fmt.Errorf("copy of the database: %w", err)
	}
	if err := os.Chmod(tmp, 0o600); err != nil {
		return fmt.Errorf("copy of the database: %w", err)
	}
	if err := safefile.Rename(tmp, filepath.Join(dir, name)); err != nil {
		return fmt.Errorf("copy of the database: %w", err)
	}
	return nil
}

// RemoveOldBackups deletes the daily copies beyond the most recent KeepBackups,
// but never the last copy with something in it: empty copies do not push it out.
// Any other file in the folder is not its business.
func RemoveOldBackups(ctx context.Context, dir string) error {
	all, err := listBackups(dir)
	if err != nil {
		return err
	}
	extra := all[min(KeepBackups, len(all)):]
	if len(extra) == 0 {
		return nil
	}
	kept := anyWithContent(ctx, dir, all[:KeepBackups])
	var errs []error
	for _, name := range extra {
		if !kept && copyHasContent(ctx, filepath.Join(dir, name)) {
			kept = true
			continue
		}
		errs = append(errs, os.Remove(filepath.Join(dir, name)))
	}
	return errors.Join(errs...)
}

// anyWithContent says whether one of the copies has something in it.
func anyWithContent(ctx context.Context, dir string, names []string) bool {
	for _, name := range names {
		if copyHasContent(ctx, filepath.Join(dir, name)) {
			return true
		}
	}
	return false
}

// copyHasContent says whether a copy has a video or a user, reading it without
// changing it. A copy that cannot be read has nothing, as far as anybody can tell.
func copyHasContent(ctx context.Context, file string) bool {
	address, err := readOnlyAddress(file)
	if err != nil {
		return false
	}
	db, err := sql.Open("sqlite", address)
	if err != nil {
		return false
	}
	filled, err := hasContent(ctx, db)
	return errors.Join(err, db.Close()) == nil && filled
}

// hasContent says whether a database has a video or a user.
func hasContent(ctx context.Context, db *sql.DB) (filled bool, err error) {
	err = db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM videos) OR EXISTS (SELECT 1 FROM users)`).Scan(&filled)
	return filled, err
}

// listBackups returns the names of the daily copies, the most recent first.
func listBackups(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read folder of the database copies: %w", err)
	}
	days := map[string]time.Time{}
	var names []string
	for _, e := range entries {
		m := backupName.FindStringSubmatch(e.Name())
		if m == nil || !e.Type().IsRegular() {
			continue
		}
		day, err := time.Parse(backupDate, m[1])
		if err != nil {
			continue // looks like one of ours and is not: 31-02-2026
		}
		days[e.Name()] = day
		names = append(names, e.Name())
	}
	slices.SortFunc(names, func(a, b string) int { return days[b].Compare(days[a]) })
	return names, nil
}

// RunBackups makes the copy of today now if it is not there, then one every
// night, until ctx is cancelled. A copy that fails is logged: the old ones stay.
func RunBackups(ctx context.Context, db *sql.DB, dir string, now func() time.Time, logger *slog.Logger) {
	removeUnfinishedBackups(dir, logger)
	today := BackupFile(now())
	if _, err := os.Stat(filepath.Join(dir, today)); errors.Is(err, fs.ErrNotExist) {
		backupNow(ctx, db, dir, today, logger)
	}
	for {
		at := now()
		timer := time.NewTimer(nextBackup(at).Sub(at))
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		backupNow(ctx, db, dir, BackupFile(now()), logger)
	}
}

// backupNow makes a copy and removes the old ones. A database with nothing in it
// is not copied when a copy has something: a disk that lost its database and
// started again must not push out the copies that can bring it back.
func backupNow(ctx context.Context, db *sql.DB, dir, name string, logger *slog.Logger) {
	if filled, err := hasContent(ctx, db); err == nil && !filled {
		if all, err := listBackups(dir); err == nil && anyWithContent(ctx, dir, all) {
			logger.WarnContext(ctx, "safety copy not made: the database is empty, older copies are not", "folder", dir)
			return
		}
	}
	if err := Backup(ctx, db, dir, name); err != nil {
		if ctx.Err() == nil {
			logger.ErrorContext(ctx, "safety copy of the database not made", "file", name, "error", err)
		}
		return
	}
	logger.InfoContext(ctx, "safety copy of the database made", "file", name)
	if err := RemoveOldBackups(ctx, dir); err != nil {
		logger.WarnContext(ctx, "remove old safety copies of the database", "error", err)
	}
}

// removeUnfinishedBackups deletes what a stop in the middle of a copy left.
func removeUnfinishedBackups(dir string, logger *slog.Logger) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), unfinishedBackup) {
			if err := os.Remove(filepath.Join(dir, e.Name())); err != nil {
				logger.Warn("remove unfinished safety copy of the database", "error", err)
			}
		}
	}
}

// RestoreIfMissing brings back the database when its file is not there and a copy
// is. It uses the most recent copy that passes the check of SQLite, an empty copy
// only when no other can be used, and reports whether the database came from a
// copy and what follows a restore is still to do (see RestoreMark). Each copy is
// tried on a temporary file, so the copies are never touched and the database
// appears whole or not at all. No copies at all means a new start: emptying the
// folder is how to ask for one.
//
// It stops, changing nothing, in two cases: when that copy was made by a newer
// FranzPLAY, because an older copy would silently lose days of data; and when no
// copy can be used, because the disk may just be in trouble.
func RestoreIfMissing(ctx context.Context, dataDir, dir string, logger *slog.Logger) (restored bool, err error) {
	file := filepath.Join(dataDir, FileName)
	if _, err := os.Stat(file); !errors.Is(err, fs.ErrNotExist) {
		// There is a database, or SQLite will say what is wrong with it. A mark
		// still here is a stop before the work after a restore was saved.
		_, marked := RestoreMark(dataDir)
		return marked, nil
	}
	names, err := listBackups(dir)
	if err != nil || len(names) == 0 {
		return false, errors.Join(err, ClearRestoreMark(dataDir))
	}
	all, err := loadMigrations(migrationsFS())
	if err != nil {
		return false, err
	}
	empty := ""
	for _, name := range names {
		used, isEmpty, err := restoreFrom(ctx, name, dir, dataDir, len(all), false, logger)
		switch {
		case err != nil:
			return false, err
		case used:
			return true, nil
		case isEmpty && empty == "":
			empty = name
		}
	}
	// Only empty copies: the most recent is still what there was.
	if empty != "" {
		if used, _, err := restoreFrom(ctx, empty, dir, dataDir, len(all), true, logger); err != nil || used {
			return used, err
		}
	}
	return false, fmt.Errorf("%w: the %d in %s are damaged. To start from nothing, empty that folder", ErrNoGoodBackup, len(names), dir)
}

// restoreFrom tries one copy. used says the database is back. isEmpty says the
// copy is good but has nothing in it: it is used only with evenEmpty.
func restoreFrom(ctx context.Context, name, dir, dataDir string, known int, evenEmpty bool,
	logger *slog.Logger,
) (used, isEmpty bool, err error) {
	file := filepath.Join(dataDir, FileName)
	tmp, err := copyForRestore(filepath.Join(dir, name), dataDir)
	if err != nil {
		logger.WarnContext(ctx, "safety copy of the database not usable", "file", name, "error", err)
		return false, false, nil
	}
	version, filled, err := checkCopy(ctx, tmp)
	switch {
	case err != nil:
		logger.WarnContext(ctx, "safety copy of the database not usable", "file", name, "error", err)
		return false, false, removeTry(tmp)
	case version > known:
		return false, false, errors.Join(fmt.Errorf("%w: %s is at version %d, this program knows up to %d: "+
			"update FranzPLAY, or take that copy away from %s", ErrBackupTooNew, name, version, known, dir), removeTry(tmp))
	case !filled && !evenEmpty:
		return false, true, removeTry(tmp)
	}
	if err := setAsideJournal(file); err != nil {
		return false, false, errors.Join(err, removeTry(tmp))
	}
	info, err := os.Stat(filepath.Join(dir, name))
	if err != nil {
		return false, false, errors.Join(fmt.Errorf("restore database from %s: %w", name, err), removeTry(tmp))
	}
	// Before the database appears: a stop right after still finds the mark.
	if err := writeRestoreMark(dataDir, info.ModTime()); err != nil {
		return false, false, errors.Join(fmt.Errorf("restore database from %s: %w", name, err), removeTry(tmp))
	}
	if err := safefile.Rename(tmp, file); err != nil {
		return false, false, errors.Join(fmt.Errorf("restore database from %s: %w", name, err), removeTry(tmp),
			ClearRestoreMark(dataDir))
	}
	logger.WarnContext(ctx, "database restored from a safety copy", "file", name)
	return true, false, nil
}

// restoreMarkFile, next to the database, says it came back from a copy, and when
// that copy was made. It is written before the database appears, and removed
// only once the database itself remembers the work to do after a restore: a stop
// at any moment in between does not forget it.
const restoreMarkFile = ".restored-from-copy"

func writeRestoreMark(dataDir string, madeAt time.Time) (err error) {
	f, err := os.OpenFile(filepath.Join(dataDir, restoreMarkFile), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, f.Close()) }()
	if _, err := f.WriteString(strconv.FormatInt(madeAt.Unix(), 10)); err != nil {
		return err
	}
	return f.Sync()
}

// RestoreMark says whether the database came back from a copy and that is still
// to deal with, and when the copy was made. A mark that cannot be understood
// still says so, with a copy of an unknown time.
func RestoreMark(dataDir string) (madeAt time.Time, marked bool) {
	data, err := os.ReadFile(filepath.Join(dataDir, restoreMarkFile))
	if err != nil {
		return time.Time{}, false
	}
	seconds, err := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
	if err != nil {
		return time.Time{}, true
	}
	return time.Unix(seconds, 0), true
}

// ClearRestoreMark removes the mark, once what it says is saved in the database.
func ClearRestoreMark(dataDir string) error {
	err := os.Remove(filepath.Join(dataDir, restoreMarkFile))
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("remove the mark of a restore: %w", err)
	}
	return nil
}

// copyForRestore copies a safety copy next to the database, under a temporary name.
func copyForRestore(from, dataDir string) (_ string, err error) {
	in, err := os.Open(from) //nolint:gosec // a file of the folder of the copies, with a name checked by listBackups
	if err != nil {
		return "", err
	}
	defer func() { err = errors.Join(err, in.Close()) }()
	out, err := os.CreateTemp(dataDir, ".restore-*")
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(out, in); err != nil {
		return "", errors.Join(err, out.Close(), os.Remove(out.Name()))
	}
	if err := out.Close(); err != nil {
		return "", errors.Join(err, os.Remove(out.Name()))
	}
	return out.Name(), nil
}

// checkCopy asks SQLite whether a file is a whole database, its version and
// whether it has anything in it.
func checkCopy(ctx context.Context, file string) (version int, filled bool, err error) {
	db, err := sql.Open("sqlite", file)
	if err != nil {
		return 0, false, err
	}
	defer func() { err = errors.Join(err, db.Close()) }()
	var answer string
	if err := db.QueryRowContext(ctx, `PRAGMA integrity_check(1)`).Scan(&answer); err != nil {
		return 0, false, err
	}
	if answer != "ok" {
		return 0, false, fmt.Errorf("damaged: %s", answer)
	}
	if err := db.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&version); err != nil {
		return 0, false, err
	}
	// An empty file is a database for SQLite, with nothing in it.
	if version < 1 {
		return 0, false, errors.New("not a database of FranzPLAY")
	}
	// A copy too new may have other tables: it counts as one with something in it.
	if filled, err = hasContent(ctx, db); err != nil {
		filled = true
	}
	return version, filled, nil
}

// removeTry deletes a temporary file and what SQLite may have put next to it.
func removeTry(file string) error {
	var errs []error
	for _, name := range []string{file, file + "-journal", file + "-wal", file + "-shm"} {
		if err := os.Remove(name); err != nil && !errors.Is(err, fs.ErrNotExist) {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// setAsideJournal moves away what a database gone left next to it. SQLite would
// apply it to the database coming back and damage it.
func setAsideJournal(file string) error {
	for _, end := range []string{"-wal", "-shm", "-journal"} {
		err := os.Rename(file+end, file+end+".orfano")
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("set aside %s: %w", filepath.Base(file+end), err)
		}
	}
	return nil
}
