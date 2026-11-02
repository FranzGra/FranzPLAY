package library

import (
	"context"
	"database/sql"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/database"
)

const restoredPrint = "v1:000000000000000000000000a1b2c3d4"

func restoredFixture(t *testing.T) (*sql.DB, content.Root, int64) {
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
	res, err := db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, added_at, cover)
		VALUES (?, 1, 'mare.mp4', 1, 1, 'Il mare', 1, 'vecchia.jpg')`, restoredPrint)
	if err != nil {
		t.Fatal(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return db, content.Root(t.TempDir()), id
}

// The copy is older than the disk: a hide written in video.json after it wins,
// and a value the folder does not have stays as the row has it.
func TestPutBackAfterRestoreTrustsTheFolder(t *testing.T) {
	db, root, id := restoredFixture(t)
	ctx := context.Background()
	if _, err := db.Exec(`UPDATE videos SET hidden_at = 77 WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := content.EnsureVideoFolder(ctx, db, root, id, restoredPrint); err != nil {
		t.Fatal(err)
	}
	if err := content.SaveManifest(ctx, db, root, id); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE videos SET hidden_at = NULL WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.DiscardHandler)
	now := time.Unix(1000, 0)

	// Not after a restore: the row is right, whatever the folder says.
	if err := PutBackAfterRestore(ctx, db, root, false, time.Time{}, now, logger); err != nil {
		t.Fatal(err)
	}
	var hidden sql.NullInt64
	if err := db.QueryRow(`SELECT hidden_at FROM videos WHERE id = ?`, id).Scan(&hidden); err != nil {
		t.Fatal(err)
	}
	if hidden.Valid {
		t.Fatalf("hidden_at = %d with no restore", hidden.Int64)
	}

	if err := PutBackAfterRestore(ctx, db, root, true, time.Time{}, now, logger); err != nil {
		t.Fatal(err)
	}
	var cover string
	if err := db.QueryRow(`SELECT hidden_at, cover FROM videos WHERE id = ?`, id).Scan(&hidden, &cover); err != nil {
		t.Fatal(err)
	}
	if hidden.Int64 != 77 {
		t.Errorf("hidden_at = %d, want the one of video.json", hidden.Int64)
	}
	if cover != "vecchia.jpg" {
		t.Errorf("cover = %q: a file only named by the row must stay", cover)
	}
	var pending int
	if err := db.QueryRow(`SELECT count(*) FROM settings WHERE key = ?`, keyAfterRestore).Scan(&pending); err != nil || pending != 0 {
		t.Errorf("the work is not marked as done: %d, %v", pending, err)
	}
}

// A folder that cannot be read says nothing: what the copy says stays.
func TestPutBackAfterRestoreSkipsAnUnreadableFolder(t *testing.T) {
	db, root, id := restoredFixture(t)
	ctx := context.Background()
	if _, err := db.Exec(`UPDATE videos SET hidden_at = 77, admin_title = 'Mio' WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	code := restoredPrint[len(restoredPrint)-8:]
	dir := filepath.Join(root.VideoFolders(), "mare ["+code+"]")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, content.FileManifest), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := PutBackAfterRestore(ctx, db, root, true, time.Time{}, time.Unix(1000, 0), slog.New(slog.DiscardHandler)); err != nil {
		t.Fatal(err)
	}
	var hidden int64
	var title string
	if err := db.QueryRow(`SELECT hidden_at, admin_title FROM videos WHERE id = ?`, id).Scan(&hidden, &title); err != nil {
		t.Fatal(err)
	}
	if hidden != 77 || title != "Mio" {
		t.Errorf("hidden_at %d, admin_title %q: an unreadable folder changed the row", hidden, title)
	}
}

// The folders the copy retired may be of videos that came back.
func TestPutBackAfterRestoreForgetsTheRetiredFolders(t *testing.T) {
	db, root, _ := restoredFixture(t)
	if _, err := db.Exec(`INSERT INTO retired_folders (fingerprint, remove_after) VALUES ('v1:x', 1)`); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(string(root), "video"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := PutBackAfterRestore(context.Background(), db, root, true, time.Time{}, time.Unix(1000, 0), slog.New(slog.DiscardHandler)); err != nil {
		t.Fatal(err)
	}
	var left int
	if err := db.QueryRow(`SELECT count(*) FROM retired_folders`).Scan(&left); err != nil || left != 0 {
		t.Errorf("%d retired folders left, %v", left, err)
	}
}
