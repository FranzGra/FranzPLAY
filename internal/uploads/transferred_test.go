package uploads

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/content"
)

// The old folder is read only until the transfer has moved what it held.
func TestOldFolders(t *testing.T) {
	s := newSite(t)
	ctx := context.Background()
	root, missing := content.Root(s.data), content.Root(t.TempDir())

	got, err := OldFolders(ctx, s.db, root, root, missing)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Errorf("folders = %v before there is an old one", got)
	}

	old, err := filepath.Abs(root.OldUploads())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(old, 0o750); err != nil {
		t.Fatal(err)
	}
	got, err = OldFolders(ctx, s.db, root, root, missing)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(got, []string{old}) {
		t.Errorf("folders = %v, want only %s, once", got, old)
	}

	if _, err := s.db.Exec(`INSERT INTO settings (key, value) VALUES ('content.uploads_moved', '1')`); err != nil {
		t.Fatal(err)
	}
	got, err = OldFolders(ctx, s.db, root)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Errorf("folders = %v after the transfer", got)
	}
}

// A video not transferred yet is still theirs to delete, but only because the
// old folder is one the service was told to keep.
func TestDeleteVideoInOldFolder(t *testing.T) {
	s := newSite(t)
	old := t.TempDir()
	file := filepath.Join(old, "mare.mp4")
	if err := os.WriteFile(file, []byte("sea"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`INSERT INTO libraries (id, path) VALUES (50, ?)`, old); err != nil {
		t.Fatal(err)
	}
	res, err := s.db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, added_at, uploaded_by)
		VALUES ('v1:old', 50, 'mare.mp4', 3, 1, 'Mare', 1, 1)`)
	if err != nil {
		t.Fatal(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}

	expect(t, s.do(t, giulia, "DELETE", videoPath(id), nil), http.StatusInternalServerError)
	if _, err := os.Stat(file); err != nil {
		t.Fatalf("a folder nobody named was touched: %v", err)
	}

	s.service.KeepOldFolders([]string{old})
	expect(t, s.do(t, giulia, "DELETE", videoPath(id), nil), http.StatusNoContent)
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Errorf("file still there: %v", err)
	}
}

// A person who deletes a video wants it gone: the copy kept by the transfer must
// not stay on the disk, and other copies are not touched.
func TestDeleteVideoTakesTheTransferredCopy(t *testing.T) {
	s := newSite(t)
	id := s.uploadVideo(t, "mare.mp4", "sea")
	folder, err := Folder(content.Root(s.data))
	if err != nil {
		t.Fatal(err)
	}
	var rel string
	if err := s.db.QueryRow(`SELECT path FROM videos WHERE id = ?`, id).Scan(&rel); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	copyOf, other := filepath.Join(dir, "mare.mp4"), filepath.Join(dir, "lago.mp4")
	for _, f := range []string{copyOf, other} {
		if err := os.WriteFile(f, []byte("sea"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.db.Exec(`INSERT INTO moved_files (old_path, new_path, size, old_sha256, new_sha256, moved_at)
		VALUES (?, ?, 3, 'a', 'a', 1), (?, ?, 3, 'b', 'b', 1)`,
		copyOf, filepath.Join(folder, filepath.FromSlash(rel)), other, filepath.Join(folder, "lago.mp4")); err != nil {
		t.Fatal(err)
	}

	expect(t, s.do(t, giulia, "DELETE", videoPath(id), nil), http.StatusNoContent)
	if _, err := os.Stat(copyOf); !os.IsNotExist(err) {
		t.Errorf("old copy still there: %v", err)
	}
	if _, err := os.Stat(other); err != nil {
		t.Errorf("the copy of another video went too: %v", err)
	}
	var left int
	if err := s.db.QueryRow(`SELECT count(*) FROM moved_files`).Scan(&left); err != nil || left != 1 {
		t.Errorf("moved_files = %d, %v, want the other video's row", left, err)
	}
}
