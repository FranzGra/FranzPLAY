package oldimport

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/media"
)

// What the administrator changed by hand in the old FranzPLAY comes too:
// the titles of the videos, the names of the categories and the covers
// they chose. Only what FranzPLAY shows changes, never a file in the video
// folders (rule 1). What the administrator already chose in the new
// FranzPLAY stays.

// Limits of the new FranzPLAY, as its database checks them.
const (
	maxTitle         = 200
	maxCategoryLabel = 100
	maxCoverBytes    = 10 << 20
)

// coverExt are the pictures a cover can be, with the extension it is kept with.
var coverExt = map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}

// oneLine turns text into one line: control characters become spaces,
// spaces at the ends go, and a text longer than limit is cut, with "…"
// at the end.
func oneLine(s string, limit int) string {
	s = strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, strings.ToValidUTF8(s, "")))
	if utf8.RuneCountInString(s) > limit {
		s = string([]rune(s)[:limit-1]) + "…"
	}
	return s
}

// titles gives the videos the titles the administrator wrote in the old
// FranzPLAY. The old one called a video by its file name until someone
// changed it: that title is not brought, the new one finds its own.
func (im *importer) titles() error {
	r := &im.report.Titles
	for _, v := range im.old.videos {
		title := oneLine(v.title, maxTitle)
		if title == "" || v.title == fileTitle(v.path) {
			continue
		}
		id, ok := im.videoOf[v.id]
		if !ok {
			r.Skipped++
			continue
		}
		res, err := im.exec(`UPDATE videos SET admin_title = ? WHERE id = ? AND admin_title IS NULL`, title, id)
		if err != nil {
			return fmt.Errorf("import: title of %s: %w", v.path, err)
		}
		switch ok, err := added(res); {
		case err != nil:
			return fmt.Errorf("import: title of %s: %w", v.path, err)
		case ok:
			r.Added++
		default:
			r.Existing++ // the new FranzPLAY has its own: kept
		}
	}
	return nil
}

// categoryNames gives the categories the names the administrator chose in
// the old FranzPLAY. A category is its folder in both: the name goes to
// the new category of the same folder, if any video has it.
func (im *importer) categoryNames() error {
	r := &im.report.Categories
	for _, c := range im.old.categories {
		label := oneLine(c.name, maxCategoryLabel)
		if label == "" || label == c.path {
			continue
		}
		var n int
		if err := im.tx.QueryRowContext(im.ctx, `SELECT count(*) FROM videos WHERE folder_category = ?`, c.path).
			Scan(&n); err != nil {
			return fmt.Errorf("import: category %s: %w", c.path, err)
		}
		if n == 0 {
			r.Skipped++
			continue
		}
		res, err := im.exec(`INSERT INTO categories (name, label) VALUES (?, ?)
			ON CONFLICT (name) DO UPDATE SET label = excluded.label WHERE categories.label IS NULL`, c.path, label)
		if err != nil {
			return fmt.Errorf("import: category %s: %w", c.path, err)
		}
		switch ok, err := added(res); {
		case err != nil:
			return fmt.Errorf("import: category %s: %w", c.path, err)
		case ok:
			r.Added++
		default:
			r.Existing++
		}
	}
	return nil
}

// covers brings the covers the administrator chose by hand. The old
// FranzPLAY kept them inside the video folders: they are only read there,
// and a copy goes in the data folder, where the new FranzPLAY keeps the
// covers it is given. It runs after the rest is saved: a cover that fails
// is only reported.
func (im *importer) covers(dataDir string) error {
	r := &im.report.Covers
	for _, v := range im.old.videos {
		if !v.manual {
			continue
		}
		id, ok := im.videoOf[v.id]
		if !ok {
			r.Failed = append(r.Failed, v.path+": il video non è nel nuovo FranzPLAY")
			continue
		}
		data, ext, err := im.readCover(v, id)
		if err != nil {
			r.Failed = append(r.Failed, fmt.Sprintf("%s: %v", v.path, err))
			continue
		}
		if im.report.Try {
			r.Added++
			continue
		}
		saved, err := im.saveCover(id, data, ext, dataDir)
		switch {
		case err != nil:
			return err
		case saved:
			r.Added++
		default:
			r.Existing++
		}
	}
	return nil
}

// readCover reads the old cover of a video, from the new video folder.
func (im *importer) readCover(v oldVideo, id int64) (_ []byte, ext string, err error) {
	root := im.folderOf[id]
	where, ok := coverPath(v.path, v.cover, im.pathOf[id])
	if !ok {
		return nil, "", errors.New("la copertina non è nella cartella del video")
	}
	f, err := os.Open(filepath.Join(root, filepath.FromSlash(where)))
	if err != nil {
		return nil, "", errors.New("file della copertina non trovato")
	}
	defer f.Close() //nolint:errcheck // read only
	data, err := io.ReadAll(io.LimitReader(f, maxCoverBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("lettura della copertina: %w", err)
	}
	if len(data) > maxCoverBytes {
		return nil, "", errors.New("copertina più grande di 10 MB")
	}
	ext, ok = coverExt[http.DetectContentType(data)]
	if !ok {
		return nil, "", errors.New("la copertina non è un'immagine JPEG, PNG o WebP")
	}
	return data, ext, nil
}

// saveCover keeps a copy of an old cover in the data folder and makes it
// the video's cover, unless the video already has one chosen in the new
// FranzPLAY.
func (im *importer) saveCover(id int64, data []byte, ext, dataDir string) (saved bool, err error) {
	dir := filepath.Join(dataDir, media.OwnCoversDir)
	name, err := media.SaveOwnFile(dir, id, ext, bytes.NewReader(data))
	if err != nil {
		return false, fmt.Errorf("import: cover of video %d: %w", id, err)
	}
	defer func() {
		if !saved {
			// Nobody uses the copy: it goes.
			err = errors.Join(err, media.RemoveOwnFile(dir, name))
		}
	}()
	tx, err := im.db.BeginTx(im.ctx, nil)
	if err != nil {
		return false, fmt.Errorf("import: cover of video %d: %w", id, err)
	}
	res, err := tx.ExecContext(im.ctx, `UPDATE videos SET own_cover = ?
		WHERE id = ? AND own_cover IS NULL AND cover_second IS NULL`, name, id)
	if err == nil {
		saved, err = added(res)
	}
	if err == nil && saved {
		err = jobs.Enqueue(im.ctx, tx, id, jobs.Cover, false, im.now)
	}
	if err != nil {
		saved = false
		return false, errors.Join(fmt.Errorf("import: cover of video %d: %w", id, err), tx.Rollback())
	}
	if err := tx.Commit(); err != nil {
		saved = false
		return false, fmt.Errorf("import: cover of video %d: %w", id, err)
	}
	return saved, nil
}

// coverPath finds an old cover inside the new video folder. oldVideo and
// oldCover are paths inside the old video folder; newVideo is the same
// video inside its new folder. The two folders can differ, like for the
// videos: the same one, one above or one below, and a folder may have
// been renamed. What the two video paths share from the end tells how:
// the part before it is the same place in both, so the cover is looked
// for there. A cover outside the new folder is not looked for.
func coverPath(oldVideo, oldCover, newVideo string) (string, bool) {
	o, n, c := split(oldVideo), split(newVideo), split(oldCover)
	if len(c) == 0 || len(o) == 0 || len(n) == 0 || strings.HasPrefix(oldCover, "/") {
		return "", false
	}
	for _, p := range c {
		if p == ".." || strings.ContainsRune(p, '\\') {
			return "", false
		}
	}
	tail := commonTail(o, n)
	if tail == 0 {
		return "", false
	}
	oldBase, newBase := o[:len(o)-tail], n[:len(n)-tail]
	if len(c) <= len(oldBase) {
		return "", false
	}
	for i, p := range oldBase {
		if c[i] != p {
			return "", false
		}
	}
	return strings.Join(append(append([]string{}, newBase...), c[len(oldBase):]...), "/"), true
}
