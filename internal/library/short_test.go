package library

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/users"
)

func TestCheckMinDuration(t *testing.T) {
	for _, tc := range []struct {
		seconds int
		ok      bool
	}{
		{0, true}, {1, true}, {20, true}, {MaxMinDuration, true},
		{-1, false}, {MaxMinDuration + 1, false},
	} {
		if err := checkMinDuration(tc.seconds); (err == nil) != tc.ok {
			t.Errorf("checkMinDuration(%d) = %v, want ok %v", tc.seconds, err, tc.ok)
		}
	}
}

func putMinDuration(t *testing.T, mux *http.ServeMux, body string, want int) {
	t.Helper()
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("PUT", "/api/library/min-duration", strings.NewReader(body)))
	if rec.Code != want {
		t.Fatalf("PUT %s = %d, want %d; body %s", body, rec.Code, want, rec.Body)
	}
}

// shown returns which videos people see, by path.
func (ts *testScanner) shown(t *testing.T) map[string]bool {
	t.Helper()
	rows, err := ts.db.Query(`SELECT path, visible FROM videos`)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			t.Error(err)
		}
	}()
	out := map[string]bool{}
	for rows.Next() {
		var p string
		var visible bool
		if err := rows.Scan(&p, &visible); err != nil {
			t.Fatal(err)
		}
		out[p] = visible
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// TestMinDurationHidesOnlyShortFolderVideos: with a minimum, the videos
// of the folders shorter than it are left out; uploaded ones and the ones
// whose length is not known yet stay. Without it, all come back.
func TestMinDurationHidesOnlyShortFolderVideos(t *testing.T) {
	lib := t.TempDir()
	for _, name := range []string{"short.mp4", "exact.mp4", "long.mp4", "unread.mp4", "uploaded.mp4"} {
		writeFile(t, lib, name, name)
	}
	ts := newTestScanner(t, lib)
	ts.scan(t, Report{Added: 5})
	for _, q := range []string{
		`INSERT INTO users (id, name, password_hash, role, created_at) VALUES (7, 'Giulia', 'x', 'user', 1)`,
		`UPDATE videos SET duration = 8 WHERE path IN ('short.mp4', 'uploaded.mp4')`,
		`UPDATE videos SET duration = 10 WHERE path = 'exact.mp4'`,
		`UPDATE videos SET duration = 600 WHERE path = 'long.mp4'`,
		`UPDATE videos SET uploaded_by = 7 WHERE path = 'uploaded.mp4'`,
	} {
		if _, err := ts.db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	changes := 0
	ts.OnChange(func() { changes++ })
	mux := adminSite(ts, &users.Account{ID: 1, Name: "Admin", Role: users.Admin})

	if o := readOverview(t, mux); o.MinDuration != 0 || o.TooShort != 0 {
		t.Fatalf("a new FranzPLAY: minimum %d, too short %d; want none", o.MinDuration, o.TooShort)
	}

	putMinDuration(t, mux, `{"seconds": 10}`, http.StatusNoContent)
	want := map[string]bool{"short.mp4": false, "exact.mp4": true, "long.mp4": true, "unread.mp4": true, "uploaded.mp4": true}
	for p, visible := range ts.shown(t) {
		if visible != want[p] {
			t.Errorf("minimum 10 s: %s shown = %v, want %v", p, visible, want[p])
		}
	}
	if o := readOverview(t, mux); o.MinDuration != 10 || o.TooShort != 1 {
		t.Errorf("minimum %d, too short %d; want 10 and 1", o.MinDuration, o.TooShort)
	}
	if changes != 1 {
		t.Errorf("told of %d changes, want 1", changes)
	}

	putMinDuration(t, mux, `{"seconds": 0}`, http.StatusNoContent)
	for p, visible := range ts.shown(t) {
		if !visible {
			t.Errorf("no minimum: %s is still left out", p)
		}
	}
	var rows int
	if err := ts.db.QueryRow(`SELECT count(*) FROM settings WHERE key = ?`, keyMinDuration).Scan(&rows); err != nil || rows != 0 {
		t.Errorf("settings rows = %d, %v; want none when there is no minimum", rows, err)
	}
}

func TestMinDurationRefusesBadValues(t *testing.T) {
	mux := adminSite(newTestScanner(t, t.TempDir()), &users.Account{ID: 1, Name: "Admin", Role: users.Admin})
	for _, body := range []string{`{}`, `{"seconds": -1}`, `{"seconds": 601}`, `{"seconds": "10"}`, `{"seconds": 10, "x": 1}`} {
		putMinDuration(t, mux, body, http.StatusBadRequest)
	}
	if o := readOverview(t, mux); o.MinDuration != 0 {
		t.Errorf("minimum = %d after bad values, want 0", o.MinDuration)
	}
}

func TestMinDurationIsForAdministrators(t *testing.T) {
	ts := newTestScanner(t, t.TempDir())
	putMinDuration(t, adminSite(ts, &users.Account{ID: 2, Name: "Giulia", Role: users.User}), `{"seconds": 10}`, http.StatusForbidden)
}

// TestMarkShortWhenTheLengthIsKnown: a video found after the minimum was
// chosen is checked as soon as its length is read.
func TestMarkShortWhenTheLengthIsKnown(t *testing.T) {
	lib := t.TempDir()
	writeFile(t, lib, "a.mp4", "a")
	ts := newTestScanner(t, lib)
	if err := ts.store.setMinDuration(context.Background(), 20); err != nil {
		t.Fatal(err)
	}
	ts.scan(t, Report{Added: 1})
	if !ts.shown(t)["a.mp4"] {
		t.Fatal("a video whose length is not known yet must be shown")
	}
	for _, tc := range []struct {
		seconds int
		shown   bool
	}{{5, false}, {45, true}} {
		if _, err := ts.db.Exec(`UPDATE videos SET duration = ?`, tc.seconds); err != nil {
			t.Fatal(err)
		}
		var id int64
		if err := ts.db.QueryRow(`SELECT id FROM videos`).Scan(&id); err != nil {
			t.Fatal(err)
		}
		if err := MarkShort(context.Background(), ts.db, id); err != nil {
			t.Fatal(err)
		}
		if got := ts.shown(t)["a.mp4"]; got != tc.shown {
			t.Errorf("%d s long, minimum 20 s: shown = %v, want %v", tc.seconds, got, tc.shown)
		}
	}
}
