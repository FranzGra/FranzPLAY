package library

import (
	"context"
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/FranzGra/FranzPLAY/internal/titles"
)

// The names FranzPLAY makes by itself from the files: the title of a
// video from the name of its file, its category from its folder, and the
// name people see of each category. They change with the administrator's
// rules (package titles), and are made again for every video when the
// rules change, without reading any file: everything comes from the paths
// in the catalog.

// categorySeparator joins the folders of a category whose last folder has
// the same name as another one's: "Serie A › Stagione 1".
const categorySeparator = " › "

// categoryNames gives each category (the path of its folder inside the
// library, as categoryOf makes it) the name people see: its last folder,
// like "Stagione 1". When two categories would show the same name, both
// show as many folders above as it takes to tell them apart: "Serie A ›
// Stagione 1" and "Serie B › Stagione 1". With clean, the administrator's
// rules tidy each folder's name too.
func categoryNames(keys []string, clean *titles.Cleaner) map[string]string {
	segments := make(map[string][]string, len(keys))
	for _, k := range keys {
		parts := strings.Split(k, "/")
		for i, p := range parts {
			parts[i] = clean.Category(p)
		}
		segments[k] = parts
	}
	out := make(map[string]string, len(keys))
	left := slices.Clone(keys)
	for depth := 1; len(left) > 0; depth++ {
		byName := make(map[string][]string, len(left))
		for _, k := range left {
			parts := segments[k]
			from := max(len(parts)-depth, 0)
			name := strings.Join(parts[from:], categorySeparator)
			byName[name] = append(byName[name], k)
		}
		left = left[:0]
		for name, ks := range byName {
			for _, k := range ks {
				// Unique, or nothing more above to tell it apart.
				if len(ks) == 1 || depth >= len(segments[k]) {
					out[k] = name
				} else {
					left = append(left, k)
				}
			}
		}
	}
	return out
}

// named is a video as renameAll reads it.
type named struct {
	id              int64
	path            string
	title, category string
}

// renameAll makes again the title and the category of every video of the
// folders, from its path and the rules, and saves the ones that changed.
// Uploaded videos keep the title their person gave them and no category,
// and a title or category chosen by the administrator stays above these
// (they are other columns). It returns how many videos changed.
func (s store) renameAll(ctx context.Context, clean *titles.Cleaner) (int, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, path, title, folder_category FROM videos WHERE uploaded_by IS NULL`)
	if err != nil {
		return 0, fmt.Errorf("names of the videos: %w", err)
	}
	var changed []named
	for rows.Next() {
		var v named
		if err := rows.Scan(&v.id, &v.path, &v.title, &v.category); err != nil {
			_ = rows.Close()
			return 0, fmt.Errorf("names of the videos: %w", err)
		}
		title, category := clean.Title(titleOf(v.path)), categoryOf(v.path)
		if title != v.title || category != v.category {
			changed = append(changed, named{id: v.id, title: title, category: category})
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return 0, fmt.Errorf("names of the videos: %w", err)
	}
	if err := rows.Close(); err != nil {
		return 0, fmt.Errorf("names of the videos: %w", err)
	}
	for batch := range slices.Chunk(changed, s.batchSize()) {
		err := func() (err error) {
			tx, err := s.db.BeginTx(ctx, nil)
			if err != nil {
				return fmt.Errorf("names of the videos: begin: %w", err)
			}
			defer func() { err = finish(tx, err) }()
			for _, v := range batch {
				// Still a video of the folders: an upload may have been
				// finished meanwhile.
				if _, err := tx.ExecContext(ctx, `UPDATE videos SET title = ?, folder_category = ?
					WHERE id = ? AND uploaded_by IS NULL`, v.title, v.category, v.id); err != nil {
					return fmt.Errorf("name of video %d: %w", v.id, err)
				}
			}
			return nil
		}()
		if err != nil {
			return 0, err
		}
	}
	return len(changed), nil
}

// syncCategoryNames saves the names people see of the categories of the
// folders (folder_categories), when they changed: a new folder, one gone,
// or other rules. It reports whether they changed.
func (s store) syncCategoryNames(ctx context.Context, clean *titles.Cleaner) (changed bool, err error) {
	keys, err := s.strings(ctx, `SELECT DISTINCT folder_category FROM videos WHERE folder_category != ''`)
	if err != nil {
		return false, fmt.Errorf("names of the categories: %w", err)
	}
	want := categoryNames(keys, clean)
	have := make(map[string]string, len(want))
	rows, err := s.db.QueryContext(ctx, `SELECT name, shown FROM folder_categories`)
	if err != nil {
		return false, fmt.Errorf("names of the categories: %w", err)
	}
	for rows.Next() {
		var name, shown string
		if err := rows.Scan(&name, &shown); err != nil {
			_ = rows.Close()
			return false, fmt.Errorf("names of the categories: %w", err)
		}
		have[name] = shown
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return false, fmt.Errorf("names of the categories: %w", err)
	}
	if err := rows.Close(); err != nil {
		return false, fmt.Errorf("names of the categories: %w", err)
	}
	if maps.Equal(have, want) {
		return false, nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("names of the categories: begin: %w", err)
	}
	defer func() { err = finish(tx, err) }()
	// Only names FranzPLAY makes by itself: what the administrator chose
	// for a category lives in the categories table, never touched here.
	if _, err := tx.ExecContext(ctx, `DELETE FROM folder_categories`); err != nil {
		return false, fmt.Errorf("names of the categories: %w", err)
	}
	for name, shown := range want {
		if _, err := tx.ExecContext(ctx, `INSERT INTO folder_categories (name, shown) VALUES (?, ?)`, name, shown); err != nil {
			return false, fmt.Errorf("name of category %q: %w", name, err)
		}
	}
	return true, nil
}

// strings returns the one text column of a query.
func (s store) strings(ctx context.Context, query string, args ...any) (_ []string, err error) {
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	var out []string
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			_ = rows.Close()
			return nil, err
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	return out, rows.Close()
}

// Retitle makes again the titles and the categories of every video of the
// folders with the rules saved now, at once, without waiting for the next
// scan. It returns how many videos changed. The scan does the same when it
// sees other rules, so a change that arrives during a scan is never lost.
func (s *Scanner) Retitle(ctx context.Context) (int, error) {
	st := store{db: s.store.db, logger: s.logger, batch: s.store.batch}
	clean, _, err := titles.LoadCleaner(ctx, st.db)
	if err != nil {
		return 0, err
	}
	n, err := st.renameAll(ctx, clean)
	if err != nil {
		return n, err
	}
	names, err := st.syncCategoryNames(ctx, clean)
	if err != nil {
		return n, err
	}
	if n > 0 || names {
		s.changed()
	}
	return n, nil
}
