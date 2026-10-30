package database

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

// TestJobsTimesAndExactPreviews: the queue gets the start and end times
// of its jobs, and the previews made from key frames only are made again;
// other jobs are left as they were.
func TestJobsTimesAndExactPreviews(t *testing.T) {
	file := filepath.Join(t.TempDir(), "x.db")
	before, err := open(context.Background(), file, migrationsUpTo(t, 48))
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO libraries (id, path) VALUES (1, '/videos')`,
		`INSERT INTO videos (id, fingerprint, library_id, path, size, mod_time, title, added_at)
			VALUES (1, 'fp1', 1, 'a.mp4', 1, 1, 'a', 1), (2, 'fp2', 1, 'b.mp4', 1, 1, 'b', 1)`,
		`INSERT INTO jobs (video_id, kind, state, attempts, last_error, updated_at)
			VALUES (1, 'preview', 'done', 1, 'old', 1), (1, 'cover', 'done', 0, '', 1),
			       (2, 'preview', 'failed', 3, 'broken', 1)`,
	} {
		if _, err := before.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	if err := before.Close(); err != nil {
		t.Fatal(err)
	}

	db := openTest(t, file, migrationsUpTo(t, 49))
	states := map[string]string{}
	rows, err := db.Query(`SELECT video_id || kind, state, started_ms, ended_ms FROM jobs`)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			t.Error(err)
		}
	}()
	for rows.Next() {
		var key, state string
		var started, ended sql.NullInt64
		if err := rows.Scan(&key, &state, &started, &ended); err != nil {
			t.Fatal(err)
		}
		if started.Valid || ended.Valid {
			t.Errorf("job %s has times %v %v, want none", key, started, ended)
		}
		states[key] = state
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if states["1preview"] != "pending" || states["1cover"] != "done" || states["2preview"] != "failed" {
		t.Errorf("states %v: want the done previews pending again, the rest as they were", states)
	}
}
