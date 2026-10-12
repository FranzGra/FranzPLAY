package oldimport

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	_ "image/jpeg" // the old FranzPLAY kept photos as JPEG…
	_ "image/png"  // …or PNG
	"io"
	"os"
	"path/filepath"

	"github.com/FranzGra/FranzPLAY/internal/users"
)

// Limits of an old profile photo. The old FranzPLAY kept the file as it
// was uploaded; a bigger one would take too much memory to decode on a
// Raspberry Pi.
const (
	maxPhotoBytes = 20 << 20
	maxPhotoSide  = 4096
)

// The side of an imported photo: as the new interface makes them.
const (
	minPhotoSide = 64
	maxSaveSide  = 512
)

var errUnsupportedPhoto = errors.New("not a JPEG or PNG picture (WEBP photos must be chosen again from the Profile)")

// photos brings the profile photos, from the old FranzPLAY's folder
// App_Data/User_Images, to the people who have none in the new one. It
// runs after the rest is saved: a photo that fails is only reported.
func (im *importer) photos(dir, dataDir string) error {
	r := &im.report.Photos
	for _, u := range im.old.users {
		id, ok := im.userOf[u.id]
		if u.photo == "" || !ok {
			continue
		}
		// Only the file name: the database cannot point outside the folder.
		path := filepath.Join(dir, filepath.Base(u.photo))
		img, err := loadPhoto(path)
		if err != nil {
			r.Failed = append(r.Failed, fmt.Sprintf("%s (%s): %v", u.name, filepath.Base(u.photo), err))
			continue
		}
		if im.report.Try {
			r.Added++
			continue
		}
		added, err := users.ImportAvatar(im.ctx, im.db, dataDir, id, squarePhoto(img), im.now)
		switch {
		case err != nil:
			return err
		case added:
			r.Added++
		default:
			r.Existing++
		}
	}
	return nil
}

// loadPhoto reads and decodes a picture, checking its size first.
func loadPhoto(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, errors.New("file not found")
	}
	defer f.Close() //nolint:errcheck // read only
	data, err := io.ReadAll(io.LimitReader(f, maxPhotoBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read photo: %w", err)
	}
	if len(data) > maxPhotoBytes {
		return nil, errors.New("file too big")
	}
	c, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, errUnsupportedPhoto
	}
	if c.Width < 1 || c.Height < 1 || c.Width > maxPhotoSide || c.Height > maxPhotoSide {
		return nil, fmt.Errorf("picture of %d×%d pixels: too big", c.Width, c.Height)
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, errUnsupportedPhoto
	}
	return img, nil
}

// squarePhoto cuts the middle square of a picture and brings it to a size
// from 64 to 512 pixels a side: each new pixel is the average of the old
// pixels it covers, so a big photo shrinks smoothly.
func squarePhoto(img image.Image) image.Image {
	b := img.Bounds()
	side := min(b.Dx(), b.Dy())
	x0, y0 := b.Min.X+(b.Dx()-side)/2, b.Min.Y+(b.Dy()-side)/2
	size := max(minPhotoSide, min(side, maxSaveSide))
	out := image.NewRGBA(image.Rect(0, 0, size, size))
	for y := range size {
		sy0, sy1 := y*side/size, max((y+1)*side/size, y*side/size+1)
		for x := range size {
			sx0, sx1 := x*side/size, max((x+1)*side/size, x*side/size+1)
			var r, g, bl, a, n uint64
			for sy := sy0; sy < sy1; sy++ {
				for sx := sx0; sx < sx1; sx++ {
					cr, cg, cb, ca := img.At(x0+sx, y0+sy).RGBA()
					r, g, bl, a, n = r+uint64(cr), g+uint64(cg), bl+uint64(cb), a+uint64(ca), n+1
				}
			}
			out.SetRGBA64(x, y, color.RGBA64{R: uint16(r / n), G: uint16(g / n), B: uint16(bl / n), A: uint16(a / n)})
		}
	}
	return out
}
