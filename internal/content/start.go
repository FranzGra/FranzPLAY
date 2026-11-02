package content

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"slices"
	"strings"
)

// ErrNoContents says the content folder is empty while the database knows videos
// or people: most of the time a disk not mounted.
var ErrNoContents = errors.New("the content folder is empty, but the database is not")

// CheckAtStart refuses to start on contents it cannot trust. A folder that cannot
// be read would look empty to every check after it, and an empty one, on its own
// disk, next to a database that is not, is a disk not mounted: in both cases
// FranzPLAY would make again what it already has, in the wrong place, and forget
// who may see what. separate is true when the content folder is not the data
// folder. A new installation, with nothing in either, starts as always. A start
// that passes leaves the folder of the copies, so the next one does not find the
// folder empty before the first copy is made.
func CheckAtStart(ctx context.Context, db *sql.DB, r Root, separate bool) error {
	entries, err := os.ReadDir(string(r))
	if err != nil {
		return fmt.Errorf("content folder %q cannot be read: %w", string(r), err)
	}
	if _, err := os.ReadDir(r.VideoFolders()); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("content folder %q cannot be read: %w", r.VideoFolders(), err)
	}
	if separate && !anyContent(entries) {
		var known bool
		if err := db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM videos) OR EXISTS (SELECT 1 FROM users)`).
			Scan(&known); err != nil {
			return fmt.Errorf("check the content folder: %w", err)
		}
		if known {
			return fmt.Errorf("%w (%s): mount the disk of the contents; to start again from nothing, "+
				"create an empty %q folder in it; to bring the old files there, run migrate-content --apply",
				ErrNoContents, string(r), "video")
		}
	}
	if err := os.MkdirAll(r.Database(), 0o750); err != nil {
		return fmt.Errorf("create %q: %w", r.Database(), err)
	}
	return nil
}

// anyContent says whether a folder holds anything FranzPLAY could have written.
// What the system leaves on an empty disk does not count.
func anyContent(entries []fs.DirEntry) bool {
	for _, e := range entries {
		if e.Name() != "lost+found" && !strings.HasPrefix(e.Name(), ".") {
			return true
		}
	}
	return false
}

// examplesOfMissing is how many codes of missing folders the log names.
const examplesOfMissing = 3

// WarnMissingFolders writes in the log when the database names files in folders
// of videos that the content folder does not have. Most of the time the content
// folder in use is not the one migrate-content filled: its setting was taken
// away, and FranzPLAY went back to the data folder, or its disk is not mounted.
// It only says so: it stops nothing, and makes or deletes nothing. A database
// that names only files of the old flat folders has nothing to miss. It reads
// the database once and the folder of the videos once.
func WarnMissingFolders(ctx context.Context, db *sql.DB, r Root, logger *slog.Logger) error {
	used, err := usedCodes(ctx, db)
	if err != nil {
		return err
	}
	delete(used, "") // the files of the old flat folders
	if len(used) == 0 {
		return nil
	}
	x := r.index()
	x.mu.Lock()
	err = x.read(r)
	var missing []string
	for code := range used {
		if _, ok := x.folders[code]; !ok {
			missing = append(missing, code)
		}
	}
	x.mu.Unlock()
	if err != nil {
		return err
	}
	if len(missing) == 0 {
		return nil
	}
	slices.Sort(missing)
	logger.WarnContext(ctx, "the database knows folders of videos the content folder does not have: "+
		"check that FRANZPLAY_CONTENT_FOLDER still names the folder of the contents and that its disk is mounted, "+
		"then start again; until then those videos have no cover, previews or subtitles",
		"missing", len(missing), "known", len(used),
		"examples", strings.Join(missing[:min(len(missing), examplesOfMissing)], ","),
		"content", string(r), "setting", "FRANZPLAY_CONTENT_DIR")
	return nil
}
