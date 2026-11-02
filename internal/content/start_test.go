package content

import (
	"bytes"
	"context"
	"database/sql"
	"log/slog"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/database"
)

// newStartDB returns an empty database with one library, closed at the end.
func newStartDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := database.Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	if _, err := db.Exec(`INSERT INTO libraries (id, path) VALUES (1, '/videos')`); err != nil {
		t.Fatal(err)
	}
	return db
}

// addStartVideo adds a video whose cover is the value given.
func addStartVideo(t *testing.T, db *sql.DB, fingerprint, path, cover string) {
	t.Helper()
	if _, err := db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, added_at, cover)
		VALUES (?, 1, ?, 1, 1, ?, 1, ?)`, fingerprint, path, path, cover); err != nil {
		t.Fatal(err)
	}
}

// warnings runs WarnMissingFolders and returns what it wrote in the log.
func warnings(t *testing.T, db *sql.DB, r Root) string {
	t.Helper()
	var log bytes.Buffer
	if err := WarnMissingFolders(context.Background(), db, r, slog.New(slog.NewTextHandler(&log, nil))); err != nil {
		t.Fatal(err)
	}
	return log.String()
}

// After migrate-content, a content folder set no more (or a disk not mounted)
// leaves the database naming folders that are not there: the log says so, and
// says how many, which ones and where it looked. Nothing else changes.
func TestStartSaysWhenTheFoldersOfTheVideosAreNotThere(t *testing.T) {
	db := newStartDB(t)
	there := Root(t.TempDir())
	const one, two = "v1:000000000000000000000000aaaaaaaa", "v1:000000000000000000000000bbbbbbbb"
	codeOne, _, err := there.EnsureFolder(one, "mare.mp4")
	if err != nil {
		t.Fatal(err)
	}
	codeTwo, _, err := there.EnsureFolder(two, "monti.mp4")
	if err != nil {
		t.Fatal(err)
	}
	addStartVideo(t, db, one, "mare.mp4", Stored(codeOne, FileCover, "1"))
	addStartVideo(t, db, two, "monti.mp4", Stored(codeTwo, FileCover, ""))
	addStartVideo(t, db, "v1:000000000000000000000000cccccccc", "lago.mp4", "3-cccccccc.jpg")

	if got := warnings(t, db, there); got != "" {
		t.Errorf("every folder is there, the log says %q", got)
	}

	elsewhere := Root(t.TempDir())
	got := warnings(t, db, elsewhere)
	for _, want := range []string{"level=WARN", "missing=2", "known=2", codeOne, codeTwo, string(elsewhere)} {
		if !strings.Contains(got, want) {
			t.Errorf("the log %q does not say %q", got, want)
		}
	}
}

// A database that names only files of the old flat folders, or nothing, has no
// folder to miss.
func TestStartSaysNothingWithoutFoldersOfVideos(t *testing.T) {
	db := newStartDB(t)
	r := Root(t.TempDir())
	if got := warnings(t, db, r); got != "" {
		t.Errorf("empty database, the log says %q", got)
	}
	addStartVideo(t, db, "v1:000000000000000000000000aaaaaaaa", "mare.mp4", "1-aaaaaaaa.jpg")
	if got := warnings(t, db, r); got != "" {
		t.Errorf("only old flat files, the log says %q", got)
	}
}
