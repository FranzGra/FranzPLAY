package media

import (
	"context"
	"database/sql"
	"errors"
	"image"
	"image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"testing"
)

// pictureRow is what the catalog says about a category picture.
type pictureRow struct {
	pending       bool
	file          sql.NullString
	width, height sql.NullInt64
}

func readPicture(t *testing.T, db *sql.DB, path string) pictureRow {
	t.Helper()
	var r pictureRow
	if err := db.QueryRow(`SELECT pending, file, width, height FROM category_pictures WHERE path = ?`, path).
		Scan(&r.pending, &r.file, &r.width, &r.height); err != nil {
		t.Fatal(err)
	}
	return r
}

func addPicture(t *testing.T, db *sql.DB, path string, size, modTime int64) {
	t.Helper()
	if _, err := db.Exec(`
		INSERT INTO category_pictures (library_id, path, category, size, mod_time) VALUES (1, ?, 'Viaggi', ?, ?)
		ON CONFLICT (library_id, path) DO UPDATE SET size = excluded.size, mod_time = excluded.mod_time, pending = 1`,
		path, size, modTime); err != nil {
		t.Fatal(err)
	}
}

// TestCategoryPicturesWithRealFFmpeg makes light copies of the pictures of
// a category with the real ffmpeg: never enlarged, never bigger than
// categoryPictureSide, and the folder of the category is never touched.
// Skipped where ffmpeg is missing.
func TestCategoryPicturesWithRealFFmpeg(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not installed")
	}
	root := t.TempDir()
	folder := filepath.Join(root, "Viaggi")
	if err := os.MkdirAll(folder, 0o750); err != nil {
		t.Fatal(err)
	}
	picture := func(name, size string) {
		t.Helper()
		if _, err := run(context.Background(), ffmpeg, "-v", "error", "-f", "lavfi",
			"-i", "color=c=red:size="+size, "-frames:v", "1", "file:"+filepath.Join(folder, name)); err != nil {
			t.Fatal(err)
		}
	}
	picture("poster.png", "300x450")
	picture("fanart.jpg", "3000x1500")
	if err := os.WriteFile(filepath.Join(folder, "cover.jpg"), []byte("not a picture"), 0o600); err != nil {
		t.Fatal(err)
	}
	db, _ := catalog(t, root, "Viaggi/mare.mp4")
	addPicture(t, db, "Viaggi/poster.png", 1, 1)
	addPicture(t, db, "Viaggi/fanart.jpg", 1, 1)
	addPicture(t, db, "Viaggi/cover.jpg", 1, 1)
	before := listDir(t, root)
	dataDir := t.TempDir()
	m := NewCategoryPictureMaker(db, ffmpeg, dataDir)

	changed, err := m.Make(context.Background())
	if err == nil {
		t.Error("Make says nothing failed, but cover.jpg is not a picture")
	}
	if changed != 2 {
		t.Errorf("Make changed %d copies, want 2", changed)
	}
	dir := filepath.Join(dataDir, CategoryPicturesDir)
	for _, tt := range []struct {
		path string
		w, h int64
	}{
		{"Viaggi/poster.png", 300, 450},  // small: not enlarged
		{"Viaggi/fanart.jpg", 1280, 640}, // big: made smaller
	} {
		r := readPicture(t, db, tt.path)
		if r.pending || !r.file.Valid || r.width.Int64 != tt.w || r.height.Int64 != tt.h {
			t.Errorf("%s = %+v, want a copy of %dx%d", tt.path, r, tt.w, tt.h)
			continue
		}
		if w, h := jpegSize(t, filepath.Join(dir, r.file.String)); int64(w) != tt.w || int64(h) != tt.h {
			t.Errorf("copy of %s is %dx%d, want %dx%d", tt.path, w, h, tt.w, tt.h)
		}
	}
	if r := readPicture(t, db, "Viaggi/cover.jpg"); r.pending || r.file.Valid {
		t.Errorf("cover.jpg = %+v, want no copy and not tried again", r)
	}
	if after := listDir(t, root); !slices.Equal(after, before) {
		t.Errorf("category folder changed: %q, before %q", after, before)
	}

	// Nothing left to make: nothing runs.
	m.run = func(context.Context, string, ...string) ([]byte, error) {
		t.Error("ffmpeg ran with nothing to make")
		return nil, nil
	}
	if changed, err := m.Make(context.Background()); err != nil || changed != 0 {
		t.Errorf("second Make = %d, %v; want 0, nil", changed, err)
	}

	// The poster is replaced: a new copy with a new name, the old one goes.
	old := readPicture(t, db, "Viaggi/poster.png").file.String
	m.run = runInBackground
	addPicture(t, db, "Viaggi/poster.png", 2, 2)
	if changed, err := m.Make(context.Background()); err != nil || changed != 1 {
		t.Fatalf("Make after a change = %d, %v; want 1, nil", changed, err)
	}
	if r := readPicture(t, db, "Viaggi/poster.png"); r.file.String == old || !r.file.Valid {
		t.Errorf("new copy = %+v, old %q", r, old)
	}
	if _, err := os.Stat(filepath.Join(dir, old)); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("old copy %s still there: %v", old, err)
	}

	// The fanart is taken away from the folder: its copy is unused and goes
	// at the next start; cover.jpg is asked for again.
	if _, err := db.Exec(`DELETE FROM category_pictures WHERE path = 'Viaggi/fanart.jpg'`); err != nil {
		t.Fatal(err)
	}
	if removed, err := RemoveOrphanCategoryPictures(context.Background(), db, dataDir); err != nil || removed != 1 {
		t.Errorf("RemoveOrphanCategoryPictures = %d, %v; want 1, nil", removed, err)
	}
	if r := readPicture(t, db, "Viaggi/cover.jpg"); !r.pending {
		t.Errorf("cover.jpg = %+v, want asked for again", r)
	}
}

// TestCategoryPictureChangedMeanwhileIsDropped: a picture replaced while
// its copy was being made keeps waiting for the next one.
func TestCategoryPictureChangedMeanwhileIsDropped(t *testing.T) {
	db, _ := catalog(t, "/videos", "Viaggi/mare.mp4")
	addPicture(t, db, "Viaggi/poster.jpg", 1, 1)
	dataDir := t.TempDir()
	m := NewCategoryPictureMaker(db, "ffmpeg", dataDir)
	m.run = func(_ context.Context, _ string, args ...string) ([]byte, error) {
		addPicture(t, db, "Viaggi/poster.jpg", 2, 2) // replaced meanwhile
		return nil, writeTinyJPEG(args[len(args)-1][len("file:"):])
	}
	if changed, err := m.Make(context.Background()); err != nil || changed != 0 {
		t.Fatalf("Make = %d, %v; want 0, nil", changed, err)
	}
	if r := readPicture(t, db, "Viaggi/poster.jpg"); !r.pending || r.file.Valid {
		t.Errorf("poster.jpg = %+v, want still waiting", r)
	}
	entries, err := os.ReadDir(filepath.Join(dataDir, CategoryPicturesDir))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Errorf("category pictures folder has %d files, want none", len(entries))
	}
}

func TestCategoryPictureArgs(t *testing.T) {
	args := categoryPictureArgs("/videos/Viaggi/poster: 1.png", "/data/out.jpg")
	if !slices.Contains(args, "file:/videos/Viaggi/poster: 1.png") || args[len(args)-1] != "file:/data/out.jpg" {
		t.Errorf("args = %q", args)
	}
}

// writeTinyJPEG writes a real JPEG of 2×1 pixels.
func writeTinyJPEG(name string) error {
	f, err := os.Create(name)
	if err != nil {
		return err
	}
	return errors.Join(jpeg.Encode(f, image.NewGray(image.Rect(0, 0, 2, 1)), nil), f.Close())
}
