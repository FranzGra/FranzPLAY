package database

import (
	"context"
	"path/filepath"
	"testing"
)

// TestFolderPicturesComeAfterTheJobsAndTranslations: real databases are
// already at version 50 with the jobs times and the translations, so those
// two keep their numbers and the pictures in the video folders come after
// them. A database at version 50 and a new one must end up the same.
func TestFolderPicturesComeAfterTheJobsAndTranslations(t *testing.T) {
	files := migrationsUpTo(t, 52)
	for _, name := range []string{
		"0049_jobs_times.sql", "0050_translations.sql", "0051_cover_images.sql", "0052_category_pictures.sql",
	} {
		if _, ok := files[name]; !ok {
			t.Errorf("no migration %s", name)
		}
	}

	file := filepath.Join(t.TempDir(), "x.db")
	before, err := open(context.Background(), file, migrationsUpTo(t, 50))
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO libraries (id, path) VALUES (1, '/videos')`,
		`INSERT INTO videos (id, fingerprint, library_id, path, size, mod_time, title, added_at)
			VALUES (1, 'fp1', 1, 'a.mp4', 1, 1, 'a', 1)`,
		`INSERT INTO jobs (video_id, kind, state, updated_at) VALUES (1, 'translate', 'done', 1)`,
	} {
		if _, err := before.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	if err := before.Close(); err != nil {
		t.Fatal(err)
	}

	upgraded := openTest(t, file, files)
	fresh := openTest(t, filepath.Join(t.TempDir(), "new.db"), files)
	if got := schemaVersion(t, upgraded); got != 52 {
		t.Errorf("upgraded database at version %d, want 52", got)
	}
	if got := schemaVersion(t, fresh); got != 52 {
		t.Errorf("new database at version %d, want 52", got)
	}

	// What was there stays, and no scan has looked for a picture yet.
	var jobs int
	if err := upgraded.QueryRow(`SELECT count(*) FROM jobs WHERE video_id = 1 AND kind = 'translate' AND state = 'done'`).
		Scan(&jobs); err != nil {
		t.Fatal(err)
	}
	if jobs != 1 {
		t.Errorf("%d jobs as they were, want 1", jobs)
	}
	var unseen int
	if err := upgraded.QueryRow(`SELECT count(*) FROM videos WHERE cover_image IS NULL`).Scan(&unseen); err != nil {
		t.Fatal(err)
	}
	if unseen != 1 {
		t.Errorf("%d videos not looked at yet, want 1", unseen)
	}

	// The two ways end with the same tables, columns and indexes.
	const schema = `SELECT group_concat(type || ' ' || name || ': ' || coalesce(sql, ''), char(10)) FROM
		(SELECT type, name, sql FROM sqlite_schema ORDER BY type, name)`
	var a, b string
	if err := upgraded.QueryRow(schema).Scan(&a); err != nil {
		t.Fatal(err)
	}
	if err := fresh.QueryRow(schema).Scan(&b); err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Errorf("the schemas differ:\nupgraded:\n%s\n\nnew:\n%s", a, b)
	}
}
