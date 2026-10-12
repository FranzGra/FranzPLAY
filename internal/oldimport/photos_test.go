package oldimport

import (
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"path/filepath"
	"testing"
)

// picture makes a w×h picture, red on the left half and blue on the right.
func picture(w, h int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			c := color.RGBA{R: 255, A: 255}
			if x >= w/2 {
				c = color.RGBA{B: 255, A: 255}
			}
			img.SetRGBA(x, y, c)
		}
	}
	return img
}

func writeJPEG(t *testing.T, path string, img image.Image) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := jpeg.Encode(f, img, nil); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestSquarePhoto(t *testing.T) {
	for _, tc := range []struct {
		w, h, side int
	}{
		{2000, 1000, 512}, // big: shrunk
		{300, 400, 300},   // already small enough: same size
		{50, 30, 64},      // tiny: brought to the smallest photo
	} {
		got := squarePhoto(picture(tc.w, tc.h))
		if b := got.Bounds(); b.Dx() != tc.side || b.Dy() != tc.side {
			t.Errorf("%d×%d → %v, want %d a side", tc.w, tc.h, b, tc.side)
		}
	}
	// The middle is kept: red on the left, blue on the right.
	got := squarePhoto(picture(2000, 1000))
	if r, _, b, _ := got.At(0, 256).RGBA(); r>>8 != 255 || b != 0 {
		t.Errorf("left = %v", got.At(0, 256))
	}
	if r, _, b, _ := got.At(511, 256).RGBA(); r != 0 || b>>8 != 255 {
		t.Errorf("right = %v", got.At(511, 256))
	}
}

func TestImportPhotos(t *testing.T) {
	db := newFranzPLAY(t)
	dataDir, photos := t.TempDir(), t.TempDir()
	writeJPEG(t, filepath.Join(photos, "user_1_1700000000.jpg"), picture(800, 600))
	run := func() *Report {
		f, err := os.Open("testdata/mariadb-dump.sql")
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close() //nolint:errcheck // read only
		r, err := Import(context.Background(), db, f, Options{Now: importDay, PhotosDir: photos, DataDir: dataDir})
		if err != nil {
			t.Fatal(err)
		}
		return r
	}

	r := run()
	if r.Photos.Added != 1 || r.LeftOut.Photos != 0 {
		t.Fatalf("photos = %+v, left out %d", r.Photos, r.LeftOut.Photos)
	}
	var id, version int64
	if err := db.QueryRow(`SELECT id, avatar FROM users WHERE name = 'Francesco'`).Scan(&id, &version); err != nil {
		t.Fatal(err)
	}
	if version != importDay.UnixMilli() {
		t.Errorf("avatar version = %d", version)
	}
	f, err := os.Open(filepath.Join(dataDir, "avatars", "1.jpg"))
	if err != nil {
		t.Fatal(err)
	}
	c, err := jpeg.DecodeConfig(f)
	_ = f.Close()
	if err != nil || c.Width != 512 || c.Height != 512 || id != 1 {
		t.Fatalf("saved photo %+v, %v (user %d)", c, err, id)
	}

	// Again: the photo is there already and stays.
	if r := run(); r.Photos.Added != 0 || r.Photos.Existing != 1 {
		t.Errorf("second import photos = %+v", r.Photos)
	}
}

func TestImportPhotosReportsWhatFails(t *testing.T) {
	db := newFranzPLAY(t)
	photos := t.TempDir()
	if err := os.WriteFile(filepath.Join(photos, "user_1_1700000000.jpg"), []byte("RIFF....WEBP"), 0o600); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open("testdata/mariadb-dump.sql")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close() //nolint:errcheck // read only
	r, err := Import(context.Background(), db, f, Options{Now: importDay, PhotosDir: photos, DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if r.Photos.Added != 0 || len(r.Photos.Failed) != 1 {
		t.Errorf("photos = %+v", r.Photos)
	}
	if got := count(t, db, `SELECT count(*) FROM users WHERE avatar != 0`); got != 0 {
		t.Error("a photo was set from a broken file")
	}
	// Everything else was saved anyway.
	if got := count(t, db, `SELECT count(*) FROM likes`); got != 3 {
		t.Errorf("likes = %d", got)
	}
}

func TestLoadPhotoRefusesMissingAndHugeFiles(t *testing.T) {
	dir := t.TempDir()
	if _, err := loadPhoto(filepath.Join(dir, "none.jpg")); err == nil {
		t.Error("missing file accepted")
	}
	huge := filepath.Join(dir, "huge.jpg")
	writeJPEG(t, huge, image.NewGray(image.Rect(0, 0, maxPhotoSide+1, 8)))
	if _, err := loadPhoto(huge); err == nil {
		t.Error("huge picture accepted")
	}
}
