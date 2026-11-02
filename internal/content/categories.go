package content

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// FileCategories is the file, in the folder of the categories, with what the
// administrator chose for them and the copies of the pictures found in their
// folders: what it takes to put them back without the database.
const FileCategories = "categorie.json"

// categoriesVersion is the format of that file.
const categoriesVersion = 1

type categoriesFile struct {
	Version int `json:"version"`
	// SavedAt is when the file last changed, in Unix seconds: after a restore it
	// says whether the choices here are newer than the copy. 0: not known.
	SavedAt    int64             `json:"savedAt,omitempty"`
	Categories []categoryChoice  `json:"categories"`
	Pictures   []categoryPicture `json:"pictures"`
}

// readableCategories says why categorie.json cannot be read, if it cannot: it
// is damaged, or written by a newer FranzPLAY. A file not there is fine.
func readableCategories(r Root) error {
	_, err := readCategoriesFile(r)
	return err
}

// readCategoriesFile reads categorie.json; a file not there is an empty one.
func readCategoriesFile(r Root) (file categoriesFile, err error) {
	data, err := os.ReadFile(filepath.Join(r.Categories(), FileCategories))
	if errors.Is(err, fs.ErrNotExist) {
		return categoriesFile{Version: categoriesVersion}, nil
	}
	if err != nil {
		return file, err
	}
	if err := json.Unmarshal(data, &file); err != nil {
		return file, err
	}
	if file.Version != categoriesVersion {
		return file, fmt.Errorf("version %d is not known to this FranzPLAY", file.Version)
	}
	return file, nil
}

// categoryChoice is what the administrator chose for a category.
type categoryChoice struct {
	Name  string  `json:"name"`
	Label *string `json:"label,omitempty"`
	Color *string `json:"color,omitempty"`
	Image *string `json:"image,omitempty"` // a file of the images of the categories
}

// categoryPicture is a picture found in the folder of a category, and its copy.
type categoryPicture struct {
	Library  string  `json:"library"`
	Path     string  `json:"path"`
	Category string  `json:"category"`
	Size     int64   `json:"size"`
	ModTime  int64   `json:"modTime"`
	File     *string `json:"file,omitempty"` // a file of the copies
	Width    *int64  `json:"width,omitempty"`
	Height   *int64  `json:"height,omitempty"`
}

// SaveCategories writes categorie.json from the database, only when it has
// something new. It is nothing until there is something to say. A file that
// cannot be read is never written over: it may be the only list of the choices,
// and of the images they name.
func SaveCategories(ctx context.Context, db *sql.DB, r Root) error {
	return saveCategories(ctx, db, r)
}

func saveCategories(ctx context.Context, db querier, r Root) (err error) {
	x := r.index()
	x.manifest.Lock()
	defer x.manifest.Unlock()

	file := categoriesFile{Version: categoriesVersion}
	if file.Categories, err = readCategoryChoices(ctx, db); err != nil {
		return fmt.Errorf("write %s: %w", FileCategories, err)
	}
	if file.Pictures, err = readCategoryPictures(ctx, db); err != nil {
		return fmt.Errorf("write %s: %w", FileCategories, err)
	}
	where := filepath.Join(r.Categories(), FileCategories)
	before, err := os.ReadFile(where)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("write %s: %w", FileCategories, err)
	}
	if len(before) == 0 && len(file.Categories) == 0 && len(file.Pictures) == 0 {
		return nil
	}
	if len(before) > 0 {
		old, err := readCategoriesFile(r)
		if err != nil {
			return fmt.Errorf("%s not written, it cannot be read: %w", FileCategories, err)
		}
		file.SavedAt = old.SavedAt
		if data, err := encodeCategories(file); err == nil && bytes.Equal(before, data) {
			return nil
		}
	}
	file.SavedAt = time.Now().Unix()
	data, err := encodeCategories(file)
	if err != nil {
		return fmt.Errorf("write %s: %w", FileCategories, err)
	}
	if err := saveFile(r.Categories(), FileCategories, data); err != nil {
		return fmt.Errorf("write %s: %w", FileCategories, err)
	}
	return nil
}

func encodeCategories(file categoriesFile) ([]byte, error) {
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}

func readCategoryChoices(ctx context.Context, db querier) (out []categoryChoice, err error) {
	rows, err := db.QueryContext(ctx, `SELECT name, label, color, image FROM categories ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		var c categoryChoice
		if err := rows.Scan(&c.Name, &c.Label, &c.Color, &c.Image); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func readCategoryPictures(ctx context.Context, db querier) (out []categoryPicture, err error) {
	rows, err := db.QueryContext(ctx, `
		SELECT l.path, p.path, p.category, p.size, p.mod_time, p.file, p.width, p.height
		FROM category_pictures p JOIN libraries l ON l.id = p.library_id ORDER BY l.path, p.path`)
	if err != nil {
		return nil, err
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		var p categoryPicture
		if err := rows.Scan(&p.Library, &p.Path, &p.Category, &p.Size, &p.ModTime, &p.File, &p.Width, &p.Height); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// validColor is a color as the administrator's page saves it.
var validColor = regexp.MustCompile(`^#[0-9a-f]{6}$`)

// RestoreCategories puts back categorie.json when the database knows nothing
// about the categories. A file that cannot be understood stays as it is, and
// nothing is put back: the choices are lost for this database, the pictures come
// back with the scan. A picture whose copy is gone waits for a new one, and an
// image gone is only not there. The file is read like a video.json: what is wrong
// in it is left out, and a picture outside the libraries of the settings is not
// put back, since its path goes to ffmpeg.
func RestoreCategories(ctx context.Context, db *sql.DB, r Root, libraries []string, logger *slog.Logger) (err error) {
	var known bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM categories) OR EXISTS (SELECT 1 FROM category_pictures)`).
		Scan(&known); err != nil {
		return fmt.Errorf("read %s: %w", FileCategories, err)
	}
	if known {
		return nil
	}
	if _, err := os.Stat(filepath.Join(r.Categories(), FileCategories)); errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	file, err := readCategoriesFile(r)
	if err != nil {
		return fmt.Errorf("read %s: %w", FileCategories, err)
	}
	configured := map[string]bool{}
	for _, l := range libraries {
		configured[filepath.Clean(l)] = true
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("read %s: %w", FileCategories, err)
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, tx.Rollback())
			return
		}
		err = tx.Commit()
	}()
	skipped := 0
	for _, c := range file.Categories {
		if c.Name == "" {
			skipped++
			continue
		}
		image := keptFile(c.Image, r.CategoryImages(), r.OldCategoryImages())
		if _, err := tx.ExecContext(ctx, `INSERT INTO categories (name, label, color, image) VALUES (?, ?, ?, ?)
			ON CONFLICT (name) DO NOTHING`, c.Name, c.Label, colorOrNil(c.Color), image); err != nil {
			return fmt.Errorf("read %s: category %q: %w", FileCategories, c.Name, err)
		}
	}
	for _, p := range file.Pictures {
		if !configured[filepath.Clean(p.Library)] || p.Path == "" || strings.Contains(p.Path, `\`) ||
			!filepath.IsLocal(filepath.FromSlash(p.Path)) {
			skipped++
			continue
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO libraries (path) VALUES (?) ON CONFLICT (path) DO NOTHING`, p.Library); err != nil {
			return fmt.Errorf("read %s: picture %q: %w", FileCategories, p.Path, err)
		}
		copied := keptFile(p.File, r.CategoryPictures(), r.OldCategoryPictures())
		width, height, pending := p.Width, p.Height, 0
		if copied == nil || width == nil || height == nil {
			copied, width, height, pending = nil, nil, nil, 1
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO category_pictures (library_id, path, category, size, mod_time, pending, file, width, height)
			SELECT id, ?, ?, ?, ?, ?, ?, ?, ? FROM libraries WHERE path = ?
			ON CONFLICT DO NOTHING`,
			p.Path, p.Category, p.Size, p.ModTime, pending, copied, width, height, p.Library); err != nil {
			return fmt.Errorf("read %s: picture %q: %w", FileCategories, p.Path, err)
		}
	}
	if skipped > 0 {
		logger.WarnContext(ctx, "values of "+FileCategories+" left out: they are not valid", "count", skipped)
	}
	logger.InfoContext(ctx, "categories put back from "+FileCategories,
		"categories", strconv.Itoa(len(file.Categories)), "pictures", strconv.Itoa(len(file.Pictures)))
	return nil
}

// colorOrNil keeps a color only if it is one.
func colorOrNil(color *string) *string {
	if color == nil || !validColor.MatchString(*color) {
		return nil
	}
	return color
}

// PutBackCategories gives a database that came back from a copy the choices for
// the categories made after that copy: only when categorie.json says it changed
// later. Otherwise what the copy says stays. The pictures come back with the scan.
func PutBackCategories(ctx context.Context, db *sql.DB, r Root, copyMadeAt time.Time, logger *slog.Logger) (err error) {
	file, err := readCategoriesFile(r)
	if err != nil {
		logger.WarnContext(ctx, "choices for the categories not put back: "+FileCategories+" cannot be read", "error", err)
		return nil
	}
	if copyMadeAt.IsZero() || file.SavedAt <= copyMadeAt.Unix() {
		return nil
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("read %s: %w", FileCategories, err)
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, tx.Rollback())
			return
		}
		err = tx.Commit()
	}()
	for _, c := range file.Categories {
		if c.Name == "" {
			continue
		}
		image := keptFile(c.Image, r.CategoryImages(), r.OldCategoryImages())
		if _, err := tx.ExecContext(ctx, `INSERT INTO categories (name, label, color, image) VALUES (?, ?, ?, ?)
			ON CONFLICT (name) DO UPDATE SET label = excluded.label, color = excluded.color, image = excluded.image`,
			c.Name, c.Label, colorOrNil(c.Color), image); err != nil {
			return fmt.Errorf("read %s: category %q: %w", FileCategories, c.Name, err)
		}
	}
	logger.InfoContext(ctx, "choices for the categories made after the copy put back", "categories", len(file.Categories))
	return nil
}

// keptFile returns a name only if it is a plain name and the file is there.
func keptFile(name *string, dir, old string) *string {
	if name == nil || *name == "" || filepath.Base(*name) != *name {
		return nil
	}
	if info, err := os.Stat(Find(dir, old, *name)); err != nil || !info.Mode().IsRegular() {
		return nil
	}
	return name
}

// saveFile writes a file all or nothing, in a folder made if needed.
func saveFile(dir, name string, data []byte) (err error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".new-*")
	if err != nil {
		return err
	}
	defer func() {
		if rmErr := os.Remove(tmp.Name()); rmErr != nil && !errors.Is(rmErr, fs.ErrNotExist) {
			err = errors.Join(err, rmErr)
		}
	}()
	if _, err := tmp.Write(data); err != nil {
		return errors.Join(err, tmp.Close())
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	// CreateTemp makes it for this user alone, like the other files here.
	if err := os.Chmod(tmp.Name(), 0o640); err != nil { //nolint:gosec // a text file with no secret in it
		return err
	}
	return renameInto(tmp.Name(), filepath.Join(dir, name))
}
