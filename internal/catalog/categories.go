package catalog

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/respond"
)

// The administrator can give each category another name, a color and an
// image, as in the old FranzPLAY. The category stays what the folders (or
// the administrator, video by video) say: only what people see changes.
// Giving two categories the same name shows them as one.

// CategoryImagesDir is the folder, inside the data folder, that holds the
// images of the categories.
const CategoryImagesDir = "category-images"

// maxCategoryImage is the largest image accepted for a category. The page
// sends a JPEG of 1280 × 720, far smaller.
const maxCategoryImage = 5 << 20

var hexColor = regexp.MustCompile(`^#[0-9a-f]{6}$`)

// Errors shown to people.
var (
	errBadColor        = errors.New("the color must be like #2997ff")
	errNotAJPEG        = errors.New("the image must be a JPEG")
	errCategoryUnknown = errors.New("no video has this category")
)

// categoryImageURL is the address of a category's image.
func categoryImageURL(name string) *string {
	u := "/api/category-images/" + name
	return &u
}

// AdminCategory is a category as the administrator sees it: as the videos
// have it, with what people see instead.
type AdminCategory struct {
	Name  string  `json:"name"`  // as the videos have it
	Label string  `json:"label"` // the name people see; "" = Name itself
	Color string  `json:"color"` // "" = none
	Image *string `json:"image"` // address of the image; nil = none
	// FolderImage and Poster are the pictures found in its folder: they do
	// not belong to the administrator, but the card people see shows them.
	FolderImage *string `json:"folderImage"`
	Poster      *string `json:"poster"`
	Videos      int     `json:"videos"`
}

// cleanColor checks a color: "" means none.
func cleanColor(color string) (string, error) {
	c := strings.ToLower(strings.TrimSpace(color))
	if c != "" && !hexColor.MatchString(c) {
		return "", errBadColor
	}
	return c, nil
}

// categoryRequest is the body of PUT /api/admin/categories/{name}.
type categoryRequest struct {
	Label *string `json:"label"` // nil or "" = the category's own name
	Color string  `json:"color"` // "" = none
}

func (a admin) handleAdminCategories(w http.ResponseWriter, r *http.Request) {
	list, err := a.store.adminCategories(r.Context())
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	respond.JSON(w, r, a.logger, http.StatusOK, list)
}

func (a admin) handleCategory(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var req categoryRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		respond.Error(w, r, a.logger, http.StatusBadRequest, "the request is not valid JSON with the expected fields")
		return
	}
	label, err := cleanCategory(req.Label)
	if err != nil {
		respond.Error(w, r, a.logger, http.StatusBadRequest, err.Error())
		return
	}
	if label != nil && (*label == "" || *label == name) {
		label = nil // the category's own name
	}
	color, err := cleanColor(req.Color)
	if err != nil {
		respond.Error(w, r, a.logger, http.StatusBadRequest, err.Error())
		return
	}
	if err := a.store.setCategoryLook(r.Context(), name, label, color); err != nil {
		a.categoryFailed(w, r, err)
		return
	}
	who, _ := a.account(r.Context())
	a.logger.InfoContext(r.Context(), "category changed", "category", name, "by", who.Name)
	a.changed()
	w.WriteHeader(http.StatusNoContent)
}

func (a admin) handleCategoryImage(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxCategoryImage))
	if maxErr := (*http.MaxBytesError)(nil); errors.As(err, &maxErr) {
		respond.Error(w, r, a.logger, http.StatusRequestEntityTooLarge, "the image is too large: at most 5 MB")
		return
	}
	if err != nil {
		respond.Error(w, r, a.logger, http.StatusBadRequest, "the image did not arrive whole")
		return
	}
	if http.DetectContentType(data) != "image/jpeg" {
		respond.Error(w, r, a.logger, http.StatusUnsupportedMediaType, errNotAJPEG.Error())
		return
	}
	id, err := a.store.categoryID(r.Context(), name)
	if err != nil {
		a.categoryFailed(w, r, err)
		return
	}
	dir := filepath.Join(a.dataDir, CategoryImagesDir)
	file, err := media.SaveOwnFile(dir, id, ".jpg", bytes.NewReader(data))
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	old, err := a.store.setCategoryImage(r.Context(), id, &file)
	if err != nil {
		a.categoryFailed(w, r, errors.Join(err, media.RemoveOwnFile(dir, file)))
		return
	}
	a.categoryImageChanged(w, r, name, dir, old)
}

func (a admin) handleRemoveCategoryImage(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	id, err := a.store.categoryID(r.Context(), name)
	if err != nil {
		a.categoryFailed(w, r, err)
		return
	}
	old, err := a.store.setCategoryImage(r.Context(), id, nil)
	if err != nil {
		a.categoryFailed(w, r, err)
		return
	}
	a.categoryImageChanged(w, r, name, filepath.Join(a.dataDir, CategoryImagesDir), old)
}

func (a admin) categoryImageChanged(w http.ResponseWriter, r *http.Request, name, dir, old string) {
	if old != "" {
		if err := media.RemoveOwnFile(dir, old); err != nil {
			// The change is saved; the old image is removed at the next start.
			a.logger.WarnContext(r.Context(), "remove old category image", "category", name, "error", err)
		}
	}
	who, _ := a.account(r.Context())
	a.logger.InfoContext(r.Context(), "category image changed", "category", name, "by", who.Name)
	a.changed()
	w.WriteHeader(http.StatusNoContent)
}

func (a admin) categoryFailed(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, errCategoryUnknown) {
		respond.Error(w, r, a.logger, http.StatusNotFound, errCategoryUnknown.Error())
		return
	}
	respond.InternalError(w, r, a.logger, err)
}

// adminCategories returns every category some video has, hidden ones too,
// as the videos have it, by name.
func (s store) adminCategories(ctx context.Context) (_ []AdminCategory, err error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT v.category, coalesce(c.label, ''), coalesce(c.color, ''), c.image, count(*)
		FROM videos v LEFT JOIN categories c ON c.name = v.category
		WHERE v.category != ''
		GROUP BY v.category ORDER BY v.category COLLATE NOCASE`)
	if err != nil {
		return nil, fmt.Errorf("list categories: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := []AdminCategory{}
	for rows.Next() {
		var c AdminCategory
		var image sql.NullString
		if err := rows.Scan(&c.Name, &c.Label, &c.Color, &image, &c.Videos); err != nil {
			return nil, fmt.Errorf("list categories: %w", err)
		}
		if image.Valid {
			c.Image = categoryImageURL(image.String)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list categories: %w", err)
	}
	found, err := s.categoryPictures(ctx)
	if err != nil {
		return nil, err
	}
	for i := range out {
		c := &out[i]
		shown := c.Label
		if shown == "" {
			shown = c.Name
		}
		c.FolderImage, c.Poster = found[shown].wide, found[shown].poster
	}
	return out, nil
}

// categoryID returns the row of a category in the categories table, made
// if missing. Only categories some video has can get one.
func (s store) categoryID(ctx context.Context, name string) (int64, error) {
	var used bool
	if err := s.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM videos WHERE category = ? AND category != '')`, name).
		Scan(&used); err != nil {
		return 0, fmt.Errorf("find category %q: %w", name, err)
	}
	if !used {
		return 0, errCategoryUnknown
	}
	var id int64
	err := s.db.QueryRowContext(ctx, `
		INSERT INTO categories (name) VALUES (?)
		ON CONFLICT (name) DO UPDATE SET name = excluded.name
		RETURNING id`, name).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("find category %q: %w", name, err)
	}
	return id, nil
}

// setCategoryLook saves the name people see and the color of a category.
func (s store) setCategoryLook(ctx context.Context, name string, label *string, color string) error {
	id, err := s.categoryID(ctx, name)
	if err != nil {
		return err
	}
	var c any // NULL: no color
	if color != "" {
		c = color
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE categories SET label = ?, color = ? WHERE id = ?`, label, c, id); err != nil {
		return fmt.Errorf("change category %q: %w", name, err)
	}
	return nil
}

// setCategoryImage saves the image of a category (nil: none), and returns
// the one it had before, which nobody uses any more.
func (s store) setCategoryImage(ctx context.Context, id int64, image *string) (old string, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("change category image: %w", err)
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, tx.Rollback())
			return
		}
		err = tx.Commit()
	}()
	var before sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT image FROM categories WHERE id = ?`, id).Scan(&before); err != nil {
		return "", fmt.Errorf("change category image: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE categories SET image = ? WHERE id = ?`, image, id); err != nil {
		return "", fmt.Errorf("change category image: %w", err)
	}
	if before.Valid && (image == nil || *image != before.String) {
		return before.String, nil
	}
	return "", nil
}

// RemoveOrphanCategoryImages deletes the files in the category images
// folder that no category uses, and uploads left half done. It must run
// before the web server starts.
func RemoveOrphanCategoryImages(ctx context.Context, db *sql.DB, dataDir string) (removed int, err error) {
	dir := filepath.Join(dataDir, CategoryImagesDir)
	entries, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("read category images folder: %w", err)
	}
	rows, err := db.QueryContext(ctx, `SELECT image FROM categories WHERE image IS NOT NULL`)
	if err != nil {
		return 0, fmt.Errorf("read category images: %w", err)
	}
	used := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return 0, errors.Join(fmt.Errorf("read category images: %w", err), rows.Close())
		}
		used[name] = true
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		return 0, fmt.Errorf("read category images: %w", err)
	}
	for _, e := range entries {
		if used[e.Name()] || e.IsDir() {
			continue
		}
		if err := media.RemoveOwnFile(dir, e.Name()); err != nil {
			return removed, err
		}
		removed++
	}
	return removed, nil
}
