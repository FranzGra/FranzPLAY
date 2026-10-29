package safefile

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

func TestRename(t *testing.T) {
	dir := t.TempDir()
	from, to := filepath.Join(dir, ".new-cover"), filepath.Join(dir, "cover.jpg")
	if err := os.WriteFile(from, []byte("picture"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Rename(from, to); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(to)
	if err != nil || string(got) != "picture" {
		t.Fatalf("file in place = %q, %v", got, err)
	}
	if _, err := os.Stat(from); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("the temporary file is still there: %v", err)
	}
}

func TestRenameOfAFileNotThere(t *testing.T) {
	dir := t.TempDir()
	err := Rename(filepath.Join(dir, "nothing"), filepath.Join(dir, "cover.jpg"))
	if !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("error = %v, want not exist", err)
	}
}
