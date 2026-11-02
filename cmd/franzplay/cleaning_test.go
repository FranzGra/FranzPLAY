package main

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

func cleaningFixture(t *testing.T) (*sql.DB, content.Root, string) {
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
	if _, err := db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, added_at)
		VALUES ('v1:000000000000000000000000a1b2c3d4', 1, 'mare.mp4', 1, 1, 'Il mare', 1)`); err != nil {
		t.Fatal(err)
	}
	root := content.Root(t.TempDir())
	if err := os.MkdirAll(root.CategoryImages(), 0o750); err != nil {
		t.Fatal(err)
	}
	image := filepath.Join(root.CategoryImages(), "caricata-dopo-la-copia.jpg")
	if err := os.WriteFile(image, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	return db, root, image
}

// With nothing to doubt, an image nobody names goes.
func TestCleaningRemovesAnUnknownCategoryImage(t *testing.T) {
	db, root, image := cleaningFixture(t)
	cleanAtStart(context.Background(), db, root, slog.New(slog.DiscardHandler))
	if _, err := os.Stat(image); !os.IsNotExist(err) {
		t.Errorf("still there: %v", err)
	}
}

// A database from a copy is older than the disk: the image may be newer than it.
func TestCleaningAfterARestoreKeepsAnUnknownCategoryImage(t *testing.T) {
	db, root, image := cleaningFixture(t)
	ctx := context.Background()
	if err := content.PrepareAfterRestore(ctx, db, time.Now()); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		cleanAtStart(ctx, db, root, slog.New(slog.DiscardHandler))
		if _, err := os.Stat(image); err != nil {
			t.Errorf("the image went: %v", err)
		}
	}
}

// A categorie.json that cannot be read may be the only one naming the image.
func TestCleaningWithAnUnreadableFileKeepsAnUnknownCategoryImage(t *testing.T) {
	for _, data := range []string{"{rotto", `{"version": 99}`} {
		db, root, image := cleaningFixture(t)
		if err := os.WriteFile(filepath.Join(root.Categories(), content.FileCategories), []byte(data), 0o600); err != nil {
			t.Fatal(err)
		}
		cleanAtStart(context.Background(), db, root, slog.New(slog.DiscardHandler))
		if _, err := os.Stat(image); err != nil {
			t.Errorf("%s: the image went: %v", data, err)
		}
	}
}
