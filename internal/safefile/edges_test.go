package safefile

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

// TestRenameReplacesTheOldFile: a cover made again takes the place of the
// old one, all at once.
func TestRenameReplacesTheOldFile(t *testing.T) {
	dir := t.TempDir()
	from, to := filepath.Join(dir, ".new"), filepath.Join(dir, "cover.jpg")
	for name, data := range map[string]string{from: "new", to: "old"} {
		if err := os.WriteFile(name, []byte(data), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := Rename(from, to); err != nil {
		t.Fatal(err)
	}
	if got, err := os.ReadFile(to); err != nil || string(got) != "new" {
		t.Errorf("file in place = %q, %v", got, err)
	}
}

// TestRenameIntoAFolderNotThere fails and leaves the temporary file, so the
// job can try again.
func TestRenameIntoAFolderNotThere(t *testing.T) {
	dir := t.TempDir()
	from := filepath.Join(dir, ".new")
	if err := os.WriteFile(from, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Rename(from, filepath.Join(dir, "gone", "cover.jpg")); err == nil {
		t.Fatal("renamed into a folder that does not exist")
	}
	if _, err := os.Stat(from); err != nil {
		t.Errorf("the temporary file is lost: %v", err)
	}
}

func TestRenameStrangeNames(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "Città d'arte (2019) 🎬")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	from, to := filepath.Join(dir, ".nuovo è"), filepath.Join(dir, "copertina [1] #2.jpg")
	if err := os.WriteFile(from, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Rename(from, to); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(to); err != nil || info.Size() != 0 {
		t.Errorf("an empty file in place: %v, %v", info, err)
	}
	if _, err := os.Stat(from); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("the temporary file is still there: %v", err)
	}
}
