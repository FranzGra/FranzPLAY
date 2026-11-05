package database

import (
	"context"
	"database/sql"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"
)

// schemaOf is every table, index, view and trigger of a database, by name.
func schemaOf(t *testing.T, db *sql.DB) map[string]string {
	t.Helper()
	rows, err := db.Query(`SELECT type || ' ' || name, coalesce(sql, '') FROM sqlite_schema
		WHERE name NOT LIKE 'sqlite_%'`)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			t.Error(err)
		}
	}()
	out := map[string]string{}
	for rows.Next() {
		var name, text string
		if err := rows.Scan(&name, &text); err != nil {
			t.Fatal(err)
		}
		out[name] = text
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func lastMigration(t *testing.T) int {
	t.Helper()
	sub, err := fs.Sub(migrationFiles, "migrations")
	if err != nil {
		t.Fatal(err)
	}
	all, err := loadMigrations(sub)
	if err != nil {
		t.Fatal(err)
	}
	return len(all)
}

// TestUpgradingOneStepAtATimeGivesTheSameSchema: a database that met every
// FranzPLAY, opened and closed once per migration, ends like a new one.
func TestUpgradingOneStepAtATimeGivesTheSameSchema(t *testing.T) {
	last := lastMigration(t)
	fresh := openTest(t, filepath.Join(t.TempDir(), "fresh.db"), migrationsUpTo(t, last))
	want := schemaOf(t, fresh)

	file := filepath.Join(t.TempDir(), "steps.db")
	for v := 1; v <= last; v++ {
		db, err := open(context.Background(), file, migrationsUpTo(t, v))
		if err != nil {
			t.Fatalf("up to %04d: %v", v, err)
		}
		if got := schemaVersion(t, db); got != v {
			t.Errorf("after %04d the version is %d", v, got)
		}
		if err := db.Close(); err != nil {
			t.Fatal(err)
		}
	}
	db := openTest(t, file, migrationsUpTo(t, last))
	got := schemaOf(t, db)
	for name, text := range want {
		if got[name] != text {
			t.Errorf("%s\n step by step: %q\n new:          %q", name, got[name], text)
		}
	}
	for name := range got {
		if _, ok := want[name]; !ok {
			t.Errorf("%s exists only step by step", name)
		}
	}
}

// TestOpeningTwiceChangesNothing: every migration runs once. Opening an up to
// date database again neither fails nor changes its schema or its rows.
func TestOpeningTwiceChangesNothing(t *testing.T) {
	dir := t.TempDir()
	db, err := Open(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO libraries (id, path) VALUES (1, '/video')`); err != nil {
		t.Fatal(err)
	}
	before, version := schemaOf(t, db), schemaVersion(t, db)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		db, err := Open(context.Background(), dir)
		if err != nil {
			t.Fatal(err)
		}
		if got := schemaVersion(t, db); got != version {
			t.Errorf("version %d, want %d", got, version)
		}
		after := schemaOf(t, db)
		if len(after) != len(before) {
			t.Errorf("%d objects, want %d", len(after), len(before))
		}
		for name, text := range before {
			if after[name] != text {
				t.Errorf("%s changed", name)
			}
		}
		var n int
		if err := db.QueryRow(`SELECT count(*) FROM libraries`).Scan(&n); err != nil || n != 1 {
			t.Errorf("libraries = %d, %v", n, err)
		}
		if err := db.Close(); err != nil {
			t.Fatal(err)
		}
	}
}

// TestFolderCategoriesAndClipMomentKeepTheData: a catalog at 0055 goes to
// 0056 (the names of the folder categories) and to 0057 (the moment of the
// clip) with every video, category, picture and choice as it was.
func TestFolderCategoriesAndClipMomentKeepTheData(t *testing.T) {
	file := filepath.Join(t.TempDir(), "x.db")
	before, err := open(context.Background(), file, migrationsUpTo(t, 55))
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO libraries (id, path) VALUES (1, '/video')`,
		`INSERT INTO videos (id, fingerprint, library_id, path, size, mod_time, title, added_at, folder_category, admin_title)
			VALUES (1, 'fp1', 1, 'Serie A/Stagione 1/è già 🎬 (1).mp4', 10, 1, 'è già 🎬 (1)', 1, 'Serie A', NULL),
			       (2, 'fp2', 1, 'b.mkv', 20, 2, 'b', 2, '', 'Scelto a mano')`,
		`INSERT INTO categories (name, label, color) VALUES ('Serie A', 'La serie', '#a1b2c3')`,
		`INSERT INTO category_pictures (library_id, path, category, size, mod_time)
			VALUES (1, 'Serie A/poster.jpg', 'Serie A', 5, 7)`,
		`INSERT INTO moved_files (old_path, new_path, size, old_sha256, new_sha256, moved_at)
			VALUES ('old', 'new', 1, 'a', 'a', 1)`,
	} {
		if _, err := before.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	if err := before.Close(); err != nil {
		t.Fatal(err)
	}

	check := func(db *sql.DB) {
		t.Helper()
		var (
			path, title, category, shown string
			n                            int
		)
		if err := db.QueryRow(`SELECT path, title, category, shown_title FROM videos WHERE id = 1`).
			Scan(&path, &title, &category, &shown); err != nil {
			t.Fatal(err)
		}
		if path != "Serie A/Stagione 1/è già 🎬 (1).mp4" || title != "è già 🎬 (1)" || category != "Serie A" || shown != title {
			t.Errorf("video 1 = %q %q %q %q", path, title, category, shown)
		}
		if err := db.QueryRow(`SELECT shown_title FROM videos WHERE id = 2`).Scan(&shown); err != nil || shown != "Scelto a mano" {
			t.Errorf("the title chosen by hand = %q, %v", shown, err)
		}
		for q, want := range map[string]int{
			`SELECT count(*) FROM categories WHERE name = 'Serie A' AND label = 'La serie' AND color = '#a1b2c3'`: 1,
			`SELECT count(*) FROM category_pictures WHERE category = 'Serie A' AND pending = 1`:                   1,
			`SELECT count(*) FROM moved_files`: 1,
			`SELECT count(*) FROM videos`:      2,
		} {
			if err := db.QueryRow(q).Scan(&n); err != nil || n != want {
				t.Errorf("%s = %d, %v; want %d", q, n, err, want)
			}
		}
	}

	at56, err := open(context.Background(), file, migrationsUpTo(t, 56))
	if err != nil {
		t.Fatal(err)
	}
	check(at56)
	var names int
	if err := at56.QueryRow(`SELECT count(*) FROM folder_categories`).Scan(&names); err != nil || names != 0 {
		// The scan writes them, from the paths: the migration only makes the table.
		t.Errorf("folder_categories = %d, %v; want an empty table", names, err)
	}
	for _, bad := range []string{
		`INSERT INTO folder_categories (name, shown) VALUES ('', 'x')`,
		`INSERT INTO folder_categories (name, shown) VALUES ('x', '')`,
	} {
		if _, err := at56.Exec(bad); err == nil {
			t.Errorf("accepted: %s", bad)
		}
	}
	if _, err := at56.Exec(`INSERT INTO folder_categories (name, shown) VALUES ('Serie A/Stagione 1', 'Stagione 1')`); err != nil {
		t.Fatal(err)
	}
	if err := at56.Close(); err != nil {
		t.Fatal(err)
	}

	db := openTest(t, file, migrationsUpTo(t, 57))
	check(db)
	if err := db.QueryRow(`SELECT count(*) FROM folder_categories WHERE shown = 'Stagione 1'`).Scan(&names); err != nil || names != 1 {
		t.Errorf("folder_categories after 0057 = %d, %v", names, err)
	}
	var unset int
	if err := db.QueryRow(`SELECT count(*) FROM videos WHERE clip_second IS NULL AND clip_seconds IS NULL`).Scan(&unset); err != nil || unset != 2 {
		t.Errorf("videos with the site's clip = %d, %v; want 2", unset, err)
	}
	for _, tt := range []struct {
		set string
		ok  bool
	}{
		{"clip_second = 0", true},
		{"clip_second = 3600", true},
		{"clip_second = -1", false},
		{"clip_seconds = 2", true},
		{"clip_seconds = 30", true},
		{"clip_seconds = 1", false},
		{"clip_seconds = 31", false},
		{"clip_second = NULL, clip_seconds = NULL", true},
	} {
		_, err := db.Exec(`UPDATE videos SET ` + tt.set + ` WHERE id = 1`)
		if (err == nil) != tt.ok {
			t.Errorf("%s: error %v, want ok %v", tt.set, err, tt.ok)
		}
		if err != nil && !strings.Contains(err.Error(), "CHECK") {
			t.Errorf("%s: %v, want a CHECK error", tt.set, err)
		}
	}
}
