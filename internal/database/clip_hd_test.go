package database

import (
	"context"
	"io/fs"
	"path/filepath"
	"testing"
	"testing/fstest"
)

// migrationsUpTo returns the real migrations numbered up to last.
func migrationsUpTo(t *testing.T, last int) fstest.MapFS {
	t.Helper()
	sub, err := fs.Sub(migrationFiles, "migrations")
	if err != nil {
		t.Fatal(err)
	}
	all, err := loadMigrations(sub)
	if err != nil {
		t.Fatal(err)
	}
	files := fstest.MapFS{}
	for _, m := range all {
		if m.version <= last {
			files[m.name] = &fstest.MapFile{Data: []byte(m.sql)}
		}
	}
	return files
}

// TestClipHDMakesFinishedClipsAgain: clips made before the sharp ones
// existed are made again, so every video gets its sharp clip; other jobs
// are left as they were.
func TestClipHDMakesFinishedClipsAgain(t *testing.T) {
	file := filepath.Join(t.TempDir(), "x.db")
	before, err := open(context.Background(), file, migrationsUpTo(t, 36))
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO libraries (id, path) VALUES (1, '/videos')`,
		`INSERT INTO videos (id, fingerprint, library_id, path, size, mod_time, title, added_at, clip)
			VALUES (1, 'fp', 1, 'a.mp4', 1, 1, 'a', 1, '1-fp.mp4')`,
		`INSERT INTO jobs (video_id, kind, state, attempts, last_error, updated_at)
			VALUES (1, 'clip', 'done', 1, 'old', 1), (1, 'cover', 'done', 1, '', 1)`,
	} {
		if _, err := before.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	if err := before.Close(); err != nil {
		t.Fatal(err)
	}

	db := openTest(t, file, migrationsUpTo(t, 37))
	states := map[string]string{}
	rows, err := db.Query(`SELECT kind, state FROM jobs`)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			t.Error(err)
		}
	}()
	for rows.Next() {
		var kind, state string
		if err := rows.Scan(&kind, &state); err != nil {
			t.Fatal(err)
		}
		states[kind] = state
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if states["clip"] != "pending" || states["cover"] != "done" {
		t.Errorf("jobs = %v, want the clip pending again and the cover still done", states)
	}
}
