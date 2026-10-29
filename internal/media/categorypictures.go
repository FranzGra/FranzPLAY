package media

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // the copies are JPEG
	"io/fs"
	"os"
	"path/filepath"
	"strconv"

	"github.com/FranzGra/FranzPLAY/internal/safefile"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// CategoryPicturesDir is the folder, inside the data folder, that holds
// the light copies of the pictures found in the folders of the categories.
const CategoryPicturesDir = "category-pictures"

// categoryPictureSide is the longest side of a copy. A category card is at
// most about 600 points wide on a computer, and the screens of a Mac have
// two pixels per point; a tall poster is shown smaller than that.
const categoryPictureSide = 1280

// CategoryPictureMaker makes the light copies of the pictures of the
// categories (category_pictures), with ffmpeg. The picture itself is only
// read (rule 1).
type CategoryPictureMaker struct {
	db      *sql.DB
	ffmpeg  string // program to run
	dataDir string
	run     runFunc
}

// NewCategoryPictureMaker returns a maker that runs the given ffmpeg
// program and writes in dataDir/category-pictures.
func NewCategoryPictureMaker(db *sql.DB, ffmpeg, dataDir string) *CategoryPictureMaker {
	return &CategoryPictureMaker{db: db, ffmpeg: ffmpeg, dataDir: dataDir, run: runInBackground}
}

// pendingPicture is a picture whose copy is still to make.
type pendingPicture struct {
	id       int64
	file     string // the picture, full path
	path     string // inside its library
	size     int64
	modTime  int64
	oldCopy  sql.NullString
	category string
}

// Make makes the copies still to make, one at a time. A picture that
// cannot be made into a copy (not really a picture) is left without one
// until it changes, and does not stop the others. It returns how many
// copies changed, so the pages can be told.
func (m *CategoryPictureMaker) Make(ctx context.Context) (changed int, err error) {
	pending, err := m.pending(ctx)
	if err != nil {
		return 0, err
	}
	dir := filepath.Join(m.dataDir, CategoryPicturesDir)
	if len(pending) > 0 {
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return 0, fmt.Errorf("create category pictures folder: %w", err)
		}
	}
	var failures []error
	for _, p := range pending {
		name, w, h, makeErr := m.makeCopy(ctx, dir, p)
		if ctx.Err() != nil {
			return changed, ctx.Err()
		}
		if makeErr != nil {
			failures = append(failures, makeErr)
		}
		saved, err := m.save(ctx, dir, p, name, w, h)
		if err != nil {
			return changed, errors.Join(append(failures, err)...)
		}
		if saved {
			changed++
		}
	}
	return changed, errors.Join(failures...)
}

func (m *CategoryPictureMaker) pending(ctx context.Context) (_ []pendingPicture, err error) {
	rows, err := m.db.QueryContext(ctx, `
		SELECT p.id, l.path, p.path, p.size, p.mod_time, p.file, p.category
		FROM category_pictures p JOIN libraries l ON l.id = p.library_id
		WHERE p.pending = 1 ORDER BY p.id`)
	if err != nil {
		return nil, fmt.Errorf("read category pictures: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	var out []pendingPicture
	for rows.Next() {
		var p pendingPicture
		var root string
		if err := rows.Scan(&p.id, &root, &p.path, &p.size, &p.modTime, &p.oldCopy, &p.category); err != nil {
			return nil, fmt.Errorf("read category pictures: %w", err)
		}
		p.file = filepath.Join(root, filepath.FromSlash(p.path))
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read category pictures: %w", err)
	}
	return out, nil
}

// makeCopy makes the copy of a picture and returns its name and size in
// pixels; "" when it could not be made.
func (m *CategoryPictureMaker) makeCopy(ctx context.Context, dir string, p pendingPicture) (name string, w, h int, err error) {
	// Rule 6: ffmpeg writes a temporary file, renamed only when complete.
	tmp, err := os.CreateTemp(dir, ".new-*.jpg")
	if err != nil {
		return "", 0, 0, fmt.Errorf("picture of category %q: %w", p.category, err)
	}
	tmpName := tmp.Name()
	defer func() {
		// Left over only when something failed; after success it was renamed.
		if rmErr := os.Remove(tmpName); rmErr != nil && !errors.Is(rmErr, fs.ErrNotExist) {
			err = errors.Join(err, rmErr)
		}
	}()
	if err := tmp.Close(); err != nil {
		return "", 0, 0, fmt.Errorf("picture of category %q: %w", p.category, err)
	}
	if _, err := m.run(ctx, m.ffmpeg, categoryPictureArgs(p.file, tmpName)...); err != nil {
		return "", 0, 0, fmt.Errorf("picture of category %q (%s): %w", p.category, p.path, err)
	}
	w, h, err = pictureSize(tmpName)
	if err != nil {
		return "", 0, 0, fmt.Errorf("picture of category %q (%s): %w", p.category, p.path, err)
	}
	// The name changes with the picture, so a browser never shows the old one.
	name = strconv.FormatInt(p.id, 10) + "-" + video.ImageVersion(p.path, p.size, p.modTime) + ".jpg"
	if err := safefile.Rename(tmpName, filepath.Join(dir, name)); err != nil {
		return "", 0, 0, fmt.Errorf("picture of category %q: %w", p.category, err)
	}
	return name, w, h, nil
}

// categoryPictureArgs builds the ffmpeg command: the picture as a JPEG
// whose longest side is categoryPictureSide at most (never enlarged).
// Going through ffmpeg also means a file that is not really a picture
// never becomes one.
func categoryPictureArgs(picture, out string) []string {
	side := strconv.Itoa(categoryPictureSide)
	return []string{"-v", "error", "-y",
		"-i", "file:" + picture,
		"-frames:v", "1",
		"-vf", "scale='min(" + side + ",iw)':'min(" + side + ",ih)':force_original_aspect_ratio=decrease",
		"-q:v", "3",
		"-f", "image2", "file:" + out}
}

// pictureSize reads the size in pixels of a JPEG from its header.
func pictureSize(file string) (w, h int, err error) {
	f, err := os.Open(file)
	if err != nil {
		return 0, 0, err
	}
	defer func() { err = errors.Join(err, f.Close()) }()
	c, _, err := image.DecodeConfig(f)
	if err != nil {
		return 0, 0, fmt.Errorf("ffmpeg wrote no picture: %w", err)
	}
	if c.Width <= 0 || c.Height <= 0 {
		return 0, 0, errors.New("ffmpeg wrote an empty picture")
	}
	return c.Width, c.Height, nil
}

// save keeps the copy made (name "" when none could be made), only if the
// picture is still the one used: if it changed meanwhile, the copy goes
// and the next scan asks again. The copy made before goes. It reports
// whether the copy changed.
func (m *CategoryPictureMaker) save(ctx context.Context, dir string, p pendingPicture, name string, w, h int) (bool, error) {
	var file, width, height any
	if name != "" {
		file, width, height = name, w, h
	}
	res, err := m.db.ExecContext(ctx, `
		UPDATE category_pictures SET file = ?, width = ?, height = ?, pending = 0
		WHERE id = ? AND size = ? AND mod_time = ?`, file, width, height, p.id, p.size, p.modTime)
	if err != nil {
		return false, errors.Join(fmt.Errorf("save picture of category %q: %w", p.category, err), removeNamed(dir, name))
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("save picture of category %q: %w", p.category, err)
	}
	if n == 0 {
		// Changed or gone meanwhile: this copy belongs to nobody.
		return false, removeNamed(dir, name)
	}
	if p.oldCopy.Valid && p.oldCopy.String != name {
		if err := removeFile(dir, p.oldCopy.String); err != nil {
			return true, err
		}
	}
	return name != "" || p.oldCopy.Valid, nil
}

// removeNamed removes a file of dir, if name is not "".
func removeNamed(dir, name string) error {
	if name == "" {
		return nil
	}
	return removeFile(dir, name)
}

// RemoveOrphanCategoryPictures deletes the copies of category pictures
// that no picture uses any more (a picture taken away from its folder),
// and asks again for the copies that could not be made: the reason may be
// gone. Like RemoveOrphanCovers, it must run before the scanner starts.
func RemoveOrphanCategoryPictures(ctx context.Context, db *sql.DB, dataDir string) (removed int, err error) {
	if _, err := db.ExecContext(ctx, `UPDATE category_pictures SET pending = 1 WHERE file IS NULL`); err != nil {
		return 0, fmt.Errorf("ask again for category pictures: %w", err)
	}
	return removeOrphans(ctx, db, filepath.Join(dataDir, CategoryPicturesDir), "category_pictures", "file")
}
