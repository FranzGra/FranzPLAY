package database

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

// TestSharperPreviewsKeepOldOnesWorking: previews made before keep their
// small frame size, so the player still reads them right, and are made
// again in the background; videos without previews and other jobs are
// left as they were.
func TestSharperPreviewsKeepOldOnesWorking(t *testing.T) {
	file := filepath.Join(t.TempDir(), "x.db")
	before, err := open(context.Background(), file, migrationsUpTo(t, 39))
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO libraries (id, path) VALUES (1, '/videos')`,
		`INSERT INTO videos (id, fingerprint, library_id, path, size, mod_time, title, added_at, preview, preview_gap, preview_count)
			VALUES (1, 'fp1', 1, 'a.mp4', 1, 1, 'a', 1, '1-fp1.jpg', 6, 100),
			       (2, 'fp2', 1, 'b.mp4', 1, 1, 'b', 1, NULL, NULL, NULL)`,
		`INSERT INTO jobs (video_id, kind, state, attempts, last_error, updated_at)
			VALUES (1, 'preview', 'done', 1, 'old', 1), (1, 'cover', 'done', 1, '', 1)`,
	} {
		if _, err := before.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	if err := before.Close(); err != nil {
		t.Fatal(err)
	}

	db := openTest(t, file, migrationsUpTo(t, 40))
	sizes := map[int64][2]sql.NullInt64{}
	rows, err := db.Query(`SELECT id, preview_width, preview_height FROM videos`)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			t.Error(err)
		}
	}()
	for rows.Next() {
		var id int64
		var w, h sql.NullInt64
		if err := rows.Scan(&id, &w, &h); err != nil {
			t.Fatal(err)
		}
		sizes[id] = [2]sql.NullInt64{w, h}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if s := sizes[1]; s[0].Int64 != 160 || s[1].Int64 != 90 {
		t.Errorf("old previews: frame %v, want 160x90", s)
	}
	if s := sizes[2]; s[0].Valid || s[1].Valid {
		t.Errorf("video without previews: frame %v, want none", s)
	}

	var preview, cover string
	if err := db.QueryRow(`SELECT
		(SELECT state FROM jobs WHERE kind = 'preview'),
		(SELECT state FROM jobs WHERE kind = 'cover')`).Scan(&preview, &cover); err != nil {
		t.Fatal(err)
	}
	if preview != "pending" || cover != "done" {
		t.Errorf("preview job %s, cover job %s; want the previews pending again and the cover still done", preview, cover)
	}
}
