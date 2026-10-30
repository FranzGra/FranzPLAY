package database

import (
	"context"
	"path/filepath"
	"testing"
)

// TestTranslationsLeaveTheOldWorkAlone: the queue gets the new kind of job,
// and nothing asked or made before starts again.
func TestTranslationsLeaveTheOldWorkAlone(t *testing.T) {
	file := filepath.Join(t.TempDir(), "x.db")
	before, err := open(context.Background(), file, migrationsUpTo(t, 49))
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO libraries (id, path) VALUES (1, '/videos')`,
		`INSERT INTO videos (id, fingerprint, library_id, path, size, mod_time, title, added_at)
			VALUES (1, 'fp1', 1, 'a.mp4', 1, 1, 'a', 1), (2, 'fp2', 1, 'b.mp4', 1, 1, 'b', 1)`,
		`INSERT INTO jobs (video_id, kind, state, attempts, last_error, updated_at)
			VALUES (1, 'transcribe', 'done', 0, '', 1), (2, 'transcribe', 'failed', 3, 'broken', 1),
			       (2, 'clip', 'pending', 0, '', 1)`,
		`INSERT INTO auto_subtitles (video_id, lang, translated_from, model, fingerprint, file, made_at)
			VALUES (1, 'en', '', 'small', 'fp1', 'a.vtt', 1), (1, 'it', 'en', 'small', 'fp1', 'b.vtt', 1)`,
	} {
		if _, err := before.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	if err := before.Close(); err != nil {
		t.Fatal(err)
	}

	db := openTest(t, file, migrationsUpTo(t, 50))
	var same, made int
	if err := db.QueryRow(`SELECT count(*) FROM jobs WHERE
		(video_id = 1 AND kind = 'transcribe' AND state = 'done') OR
		(video_id = 2 AND kind = 'transcribe' AND state = 'failed' AND attempts = 3 AND last_error = 'broken') OR
		(video_id = 2 AND kind = 'clip' AND state = 'pending')`).Scan(&same); err != nil {
		t.Fatal(err)
	}
	if same != 3 {
		t.Errorf("%d jobs as they were, want 3", same)
	}
	if err := db.QueryRow(`SELECT count(*) FROM auto_subtitles`).Scan(&made); err != nil {
		t.Fatal(err)
	}
	if made != 2 {
		t.Errorf("%d subtitles kept, want 2", made)
	}
	if _, err := db.Exec(`INSERT INTO jobs (video_id, kind, state, updated_at) VALUES (1, 'translate', 'pending', 1)`); err != nil {
		t.Errorf("the queue refuses a translation: %v", err)
	}
	// It gives way to the short jobs, so it comes after them: before them, it
	// would stop and start again for ever while they wait.
	var first string
	if err := db.QueryRow(`SELECT kind FROM jobs WHERE state = 'pending' ORDER BY priority, id LIMIT 1`).Scan(&first); err != nil {
		t.Fatal(err)
	}
	if first != "clip" {
		t.Errorf("first job %q, want clip", first)
	}
}
