package content

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

// keyHoldFlatFiles is the settings row that says the old flat files were found
// by a database that knew nothing about them, and when. While it is there no
// flat file is deleted: their names depend on the ids of a database gone, so
// they are not reused, but only the administrator can say they are worth nothing.
const keyHoldFlatFiles = "content.hold_flat_files"

// keyHoldCategoryFiles is the settings row that says the images of the categories
// and their copies that nobody names must stay: the database came back from a
// copy, older than they may be, or categorie.json could not be read and may be
// the only list naming them. It goes when every one of them is named again.
const keyHoldCategoryFiles = "content.hold_category_files"

// flatFolders are the old flat folders whose files a cleaning would delete.
func (r Root) flatFolders() []string {
	return []string{r.Covers(), r.OwnCovers(), r.Previews(), r.Clips(), r.ClipsHD(), r.OwnClips(), r.Converted(),
		r.Subtitles(), r.AutoSubtitles(), r.OnlineImages(), r.OldCategoryImages(), r.OldCategoryPictures()}
}

// countFiles counts the files in a folder, leaving out what is in the middle of
// being made.
func countFiles(dir string) (int, error) {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	n := 0
	for _, e := range entries {
		if !e.IsDir() && !strings.HasPrefix(e.Name(), ".new-") {
			n++
		}
	}
	return n, nil
}

// holdFlatFiles remembers that no flat file may be deleted.
func holdFlatFiles(ctx context.Context, db execer, now time.Time) error {
	_, err := db.ExecContext(ctx, `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING`,
		keyHoldFlatFiles, strconv.FormatInt(now.Unix(), 10))
	return err
}

// PrepareAfterRestore makes the cleanings prudent for a database that came back
// from a copy. Its rows are older than the disk, so what they say about the
// folders of videos gone may no longer be true: those folders become unknown,
// and an unknown folder is never deleted. Flat files are held like those found by
// an empty database.
func PrepareAfterRestore(ctx context.Context, db *sql.DB, now time.Time) error {
	if _, err := db.ExecContext(ctx, `DELETE FROM retired_folders`); err != nil {
		return fmt.Errorf("after a restore: %w", err)
	}
	if err := holdFlatFiles(ctx, db, now); err != nil {
		return fmt.Errorf("after a restore: %w", err)
	}
	if err := holdCategoryFiles(ctx, db, now); err != nil {
		return fmt.Errorf("after a restore: %w", err)
	}
	return nil
}

// holdCategoryFiles remembers that no image of the categories may be deleted.
func holdCategoryFiles(ctx context.Context, db execer, now time.Time) error {
	_, err := db.ExecContext(ctx, `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING`,
		keyHoldCategoryFiles, strconv.FormatInt(now.Unix(), 10))
	return err
}

// Cleaning is what the cleanings at the start may touch.
type Cleaning struct {
	Folders    bool // the folders the database saw lose their video
	Flat       bool // the old flat files nobody names
	Categories bool // the images of the categories, and their copies, nobody names
}

// PlanCleaning decides what the cleanings at the start may delete. It must run
// before them and before the first scan.
//
//   - A database with no video knows nothing yet, so nothing goes. If flat files
//     are there, this is remembered, because after the first scan the database
//     has videos and those files would look unused.
//   - Remembered once, flat files stay until the administrator decides, or until
//     there are none left: then there is nothing to remember.
//   - In any other case every cleaning runs.
//
// The images of the categories follow the flat files, and are held apart too
// (see keyHoldCategoryFiles). When it cannot read, it doubts: nothing goes.
func PlanCleaning(ctx context.Context, db *sql.DB, r Root, now time.Time, logger *slog.Logger) (Cleaning, error) {
	plan, err := planFlat(ctx, db, r, now, logger)
	if err != nil || !plan.Flat {
		return plan, err
	}
	held, err := holdCategories(ctx, db, r, now, logger)
	if err != nil {
		return Cleaning{}, fmt.Errorf("plan the cleaning: %w", err)
	}
	plan.Categories = !held
	return plan, nil
}

// holdCategories says whether the images of the categories nobody names must
// stay, and remembers it.
func holdCategories(ctx context.Context, db *sql.DB, r Root, now time.Time, logger *slog.Logger) (bool, error) {
	var held bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM settings WHERE key = ?)`, keyHoldCategoryFiles).
		Scan(&held); err != nil {
		return false, err
	}
	if !held {
		err := readableCategories(r)
		if err == nil {
			return false, nil
		}
		logger.WarnContext(ctx, "images of the categories kept: "+FileCategories+" cannot be read", "error", err)
		return true, holdCategoryFiles(ctx, db, now)
	}
	unnamed, err := unnamedCategoryFiles(ctx, db, r)
	if err != nil {
		return true, err
	}
	if unreadable := readableCategories(r); unnamed > 0 || unreadable != nil {
		logger.WarnContext(ctx, "images of the categories nobody names kept: delete them by hand if they are not needed",
			"count", unnamed, "folder", r.Categories(), "error", unreadable)
		return true, nil //nolint:nilerr // a file not readable keeps the images, it does not stop the start
	}
	_, err = db.ExecContext(ctx, `DELETE FROM settings WHERE key = ?`, keyHoldCategoryFiles)
	return false, err
}

// unnamedCategoryFiles counts the images of the categories and their copies that
// the database does not name.
func unnamedCategoryFiles(ctx context.Context, db *sql.DB, r Root) (int, error) {
	named, err := column(ctx, db, `SELECT image FROM categories WHERE image IS NOT NULL
		UNION SELECT file FROM category_pictures WHERE file IS NOT NULL`)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, dir := range []string{r.CategoryImages(), r.OldCategoryImages(), r.CategoryPictures(), r.OldCategoryPictures()} {
		entries, err := os.ReadDir(dir)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return 0, err
		}
		for _, e := range entries {
			if !e.IsDir() && !strings.HasPrefix(e.Name(), ".new-") && !named[e.Name()] {
				n++
			}
		}
	}
	return n, nil
}

// planFlat decides about the folders of the videos and the old flat files.
func planFlat(ctx context.Context, db *sql.DB, r Root, now time.Time, logger *slog.Logger) (Cleaning, error) {
	var empty, held bool
	err := db.QueryRowContext(ctx, `SELECT NOT EXISTS (SELECT 1 FROM videos),
		EXISTS (SELECT 1 FROM settings WHERE key = ?)`, keyHoldFlatFiles).Scan(&empty, &held)
	if err != nil {
		return Cleaning{}, fmt.Errorf("plan the cleaning: %w", err)
	}
	if !empty && !held {
		return Cleaning{Folders: true, Flat: true}, nil
	}
	total := 0
	for _, dir := range r.flatFolders() {
		n, err := countFiles(dir)
		if err != nil {
			return Cleaning{}, fmt.Errorf("plan the cleaning: %w", err)
		}
		if n > 0 {
			logger.InfoContext(ctx, "old files kept and not reused: the database does not know them", "folder", dir, "count", n)
		}
		total += n
	}
	if total > 0 {
		logger.WarnContext(ctx, "old files kept until the administrator decides", "count", total)
		if !held {
			if err := holdFlatFiles(ctx, db, now); err != nil {
				return Cleaning{}, fmt.Errorf("plan the cleaning: %w", err)
			}
		}
	}
	if held && total == 0 {
		if _, err := db.ExecContext(ctx, `DELETE FROM settings WHERE key = ?`, keyHoldFlatFiles); err != nil {
			return Cleaning{}, fmt.Errorf("plan the cleaning: %w", err)
		}
		return Cleaning{Folders: !empty, Flat: !empty}, nil
	}
	return Cleaning{Folders: !empty}, nil
}
