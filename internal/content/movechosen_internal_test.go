package content

import (
	"context"
	"os"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/database"
)

// A choice made while the old one was being moved stays: the old one does not
// write over it, and the row keeps naming it.
func TestMovingAChoiceLeavesANewerOneAlone(t *testing.T) {
	ctx := context.Background()
	db, err := database.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	r := Root(t.TempDir())
	const oldPrint, newPrint = "v1:000000000000000000000000aaaaaaaa", "v1:000000000000000000000000bbbbbbbb"
	oldCode, _, err := r.EnsureFolder(oldPrint, "mare.mp4")
	if err != nil {
		t.Fatal(err)
	}
	newCode, _, err := r.EnsureFolder(newPrint, "mare.mp4")
	if err != nil {
		t.Fatal(err)
	}
	file := FileOwnCover + ".png"
	if err := r.PutBytes(oldCode, file, []byte("old")); err != nil {
		t.Fatal(err)
	}
	if err := r.PutBytes(newCode, file, []byte("new")); err != nil {
		t.Fatal(err)
	}
	newer := Stored(newCode, file, "new")
	if _, err := db.Exec(`INSERT INTO libraries (id, path) VALUES (1, '/videos')`); err != nil {
		t.Fatal(err)
	}
	res, err := db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, added_at, own_cover)
		VALUES (?, 1, 'mare.mp4', 1, 1, 'Il mare', 1, ?)`, newPrint, newer)
	if err != nil {
		t.Fatal(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	value := Stored(oldCode, file, "old")
	old, ok := parseStored(value)
	if !ok {
		t.Fatal("not a stored value")
	}
	if err := r.moveChosen(ctx, db, id, "own_cover", value, old, newCode); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(r.FileIn(newCode, file)); err != nil || string(data) != "new" {
		t.Errorf("the newer choice: %q, %v", data, err)
	}
	var saved string
	if err := db.QueryRow(`SELECT own_cover FROM videos WHERE id = ?`, id).Scan(&saved); err != nil || saved != newer {
		t.Errorf("row %q, %v", saved, err)
	}
}
