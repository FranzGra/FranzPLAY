package database

import (
	"context"
	"path/filepath"
	"testing"
)

// TestPixelFormatChecksEveryVideoAgain: once iPhones and Macs count too,
// every video already read decides again whether it needs a copy; videos
// not read yet, or missing, are left alone.
func TestPixelFormatChecksEveryVideoAgain(t *testing.T) {
	file := filepath.Join(t.TempDir(), "x.db")
	before, err := open(context.Background(), file, migrationsUpTo(t, 38))
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO libraries (id, path) VALUES (1, '/videos')`,
		`INSERT INTO videos (id, fingerprint, library_id, path, size, mod_time, title, added_at, video_codec, missing_since)
			VALUES (1, 'a', 1, 'read.webm', 1, 1, 'a', 1, 'vp9', NULL),
			       (2, 'b', 1, 'new.mkv', 1, 1, 'b', 1, NULL, NULL),
			       (3, 'c', 1, 'gone.mkv', 1, 1, 'c', 1, 'h264', 5)`,
		`INSERT INTO jobs (video_id, kind, state, attempts, last_error, updated_at)
			VALUES (1, 'convert', 'done', 1, 'old', 1), (1, 'cover', 'done', 1, '', 1)`,
	} {
		if _, err := before.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	if err := before.Close(); err != nil {
		t.Fatal(err)
	}

	db := openTest(t, file, migrationsUpTo(t, 39))
	var got string
	if err := db.QueryRow(`SELECT group_concat(video_id || ' ' || kind || ' ' || state, ', ')
		FROM (SELECT * FROM jobs ORDER BY video_id, kind)`).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if want := "1 convert pending, 1 cover done"; got != want {
		t.Errorf("jobs = %q, want %q", got, want)
	}
	var pixels any
	if err := db.QueryRow(`SELECT pixel_format FROM videos WHERE id = 1`).Scan(&pixels); err != nil || pixels != nil {
		t.Errorf("pixel format = %v, %v; want not read yet", pixels, err)
	}
}
