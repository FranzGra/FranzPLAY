package online

import (
	"context"
	"os"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/content"
)

// A late answer writes no picture and removes none: the folder of the old content
// may be in use.
func TestALatePictureLeavesTheFileInUseAlone(t *testing.T) {
	fx := newFixture(t, "Gita [dQw4w9WgXcQ].mp4", true)
	if err := fx.f.save(context.Background(), fx.id, "fingerprint-1", "", found{image: []byte("first")}); err != nil {
		t.Fatal(err)
	}
	root := content.Root(fx.dataDir)
	saved := fx.read(t).cover
	if !saved.Valid {
		t.Fatal("no picture")
	}
	file := root.File(saved.String, root.OnlineImages())
	if _, err := fx.db.Exec(`UPDATE videos SET fingerprint = 'other', online_cover = NULL WHERE id = ?`, fx.id); err != nil {
		t.Fatal(err)
	}
	if err := fx.f.save(context.Background(), fx.id, "fingerprint-1", "", found{image: []byte("late")}); err != nil {
		t.Error(err)
	}
	data, err := os.ReadFile(file)
	if err != nil || string(data) != "first" {
		t.Errorf("file in use: %q, %v", data, err)
	}
}
