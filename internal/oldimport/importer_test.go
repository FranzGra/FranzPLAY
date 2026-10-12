package oldimport

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/database"
)

// importDay is when the tests run the import: a day after the old
// database was saved, so its access log is recent.
var importDay = time.Date(2026, 10, 13, 9, 0, 0, 0, time.UTC)

// newFranzPLAY makes a new FranzPLAY that has found three of the four
// videos of the fixture, in a folder that holds the old video folder's
// content. "Vecchio/sparito.mp4" is gone.
func newFranzPLAY(t *testing.T) *sql.DB {
	t.Helper()
	db, err := database.Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	exec(t, db, `INSERT INTO libraries (id, path) VALUES (1, '/srv/video')`)
	for i, v := range []struct {
		path     string
		duration int
	}{
		{"Vacanze/Mare 2019.mp4", 190},
		{"Film/Il sorpasso (1962).mp4", 6300},
		{"Tom & Jerry #2.mp4", 420},
		{"Altro/Mare 2019.mp4", 30}, // same name, other folder: must not be confused
	} {
		exec(t, db, `INSERT INTO videos (id, fingerprint, library_id, path, size, mod_time, title, added_at, duration)
			VALUES (?, ?, 1, ?, 1, 0, 'x', 0, ?)`, i+1, "fp"+v.path, v.path, v.duration)
	}
	return db
}

func exec(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

func count(t *testing.T, db *sql.DB, query string, args ...any) int {
	t.Helper()
	var n int
	if err := db.QueryRow(query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func runImport(t *testing.T, db *sql.DB, try bool) *Report {
	t.Helper()
	f, err := os.Open("testdata/mariadb-dump.sql")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close() //nolint:errcheck // read only
	r, err := Import(context.Background(), db, f, Options{Try: try, Now: importDay})
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestImportBringsEverything(t *testing.T) {
	db := newFranzPLAY(t)
	r := runImport(t, db, false)

	// Videos: found by path; the missing one is reported.
	if r.Videos.Old != 4 || r.Videos.Found != 3 || len(r.Videos.Missing) != 1 || r.Videos.Missing[0] != "Vecchio/sparito.mp4" {
		t.Errorf("videos = %+v", r.Videos)
	}

	// People: the old password hash is kept, so the same password works.
	var hash, role string
	var color sql.NullString
	var lastLogin sql.NullInt64
	if err := db.QueryRow(`SELECT password_hash, role, accent_color, last_login FROM users WHERE name = 'Francesco'`).
		Scan(&hash, &role, &color, &lastLogin); err != nil {
		t.Fatal(err)
	}
	if hash != "$2y$10$FRx/ktSH1VVy7vVPqX7NIOQg2EGYNH/ntGZ1h8WtckxhdWnUDvzVy" || role != "admin" ||
		color.String != "#dc2626" || lastLogin.Int64 != time.Date(2026, 10, 1, 19, 0, 0, 0, time.UTC).Unix() {
		t.Errorf("Francesco = %s %s %v %v", hash, role, color, lastLogin)
	}
	if got := count(t, db, `SELECT count(*) FROM users WHERE name = 'nonna_pina' AND role = 'user' AND accent_color IS NULL`); got != 1 {
		t.Error("nonna_pina not added as a normal user")
	}
	// "Al" is too short for the new FranzPLAY; "rosso" is not a color.
	if len(r.People.Renamed) != 1 || r.People.Renamed[0] != (Renamed{Old: "Al", New: "Al_"}) {
		t.Errorf("renamed = %+v", r.People.Renamed)
	}
	if got := count(t, db, `SELECT count(*) FROM users WHERE name = 'Al_' AND accent_color IS NULL`); got != 1 {
		t.Error("Al not added as Al_")
	}
	// Francesco had closed the "saved" row of the Home.
	if got := count(t, db, `SELECT count(*) FROM closed_home_rows r JOIN users u ON u.id = r.user_id
		WHERE u.name = 'Francesco' AND r.row = 'saved'`); got != 1 || count(t, db, `SELECT count(*) FROM closed_home_rows`) != 1 {
		t.Error("closed home rows not brought")
	}

	// Likes: the one on the missing video is left out. The old clock was
	// Italian: 10:00 in June is 08:00 UTC.
	if r.Likes != (Counts{Added: 3, Skipped: 1}) {
		t.Errorf("likes = %+v", r.Likes)
	}
	if got := count(t, db, `SELECT count(*) FROM likes l JOIN users u ON u.id = l.user_id
		WHERE u.name = 'Francesco' AND l.video_id = 1 AND l.created_at = ?`,
		time.Date(2025, 6, 1, 8, 0, 0, 0, time.UTC).Unix()); got != 1 {
		t.Error("Francesco's like on the sea video is missing or has the wrong time")
	}
	if got := count(t, db, `SELECT count(*) FROM likes WHERE video_id = 4`); got != 0 {
		t.Error("a like went to the other video with the same name")
	}

	// Comments: texts as written, the long one cut, the empty one left out.
	if r.Comments != (CommentCounts{Counts: Counts{Added: 3, Skipped: 1}, Empty: 1, Shortened: 1}) {
		t.Errorf("comments = %+v", r.Comments)
	}
	var body string
	if err := db.QueryRow(`SELECT body FROM comments WHERE video_id = 1 ORDER BY created_at LIMIT 1`).Scan(&body); err != nil {
		t.Fatal(err)
	}
	if body != "Che bello! L'acqua era \"fredda\"\nVero 😄 \\ fine" {
		t.Errorf("comment = %q", body)
	}
	if got := count(t, db, `SELECT length(body) FROM comments WHERE video_id = 2`); got != maxComment {
		t.Errorf("long comment has %d characters", got)
	}

	// Saved videos are in "Guarda più tardi".
	if r.Saved != (Counts{Added: 2}) {
		t.Errorf("saved = %+v", r.Saved)
	}
	if got := count(t, db, `SELECT count(*) FROM playlist_items i JOIN playlists p ON p.id = i.playlist_id
		JOIN users u ON u.id = p.user_id WHERE u.name = 'nonna_pina' AND p.kind = 'later' AND i.video_id = 2 AND i.position = 1`); got != 1 {
		t.Error("nonna_pina's saved video is not in Guarda più tardi")
	}

	// History: 3000 s of a 1h45 film is halfway, not finished (the old
	// version said finished); 185 s of a 190 s video is finished; the
	// TIMESTAMP column was saved in UTC.
	type mark struct {
		position             int64
		finished, inContinue bool
		updated              int64
	}
	marks := map[string]mark{}
	rows, err := db.Query(`SELECT u.name || '/' || p.video_id, p.position, p.finished, p.in_continue, p.updated_at
		FROM watch_progress p JOIN users u ON u.id = p.user_id`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var k string
		var m mark
		if err := rows.Scan(&k, &m.position, &m.finished, &m.inContinue, &m.updated); err != nil {
			t.Fatal(err)
		}
		marks[k] = m
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		t.Fatal(err)
	}
	want := map[string]mark{
		"Francesco/2":  {3000, false, true, time.Date(2025, 8, 1, 20, 0, 0, 0, time.UTC).Unix()},
		"Francesco/3":  {50, false, true, time.Date(2025, 8, 3, 20, 0, 0, 0, time.UTC).Unix()},
		"nonna_pina/1": {0, true, false, time.Date(2025, 8, 2, 20, 0, 0, 0, time.UTC).Unix()},
	}
	if len(marks) != len(want) {
		t.Errorf("history = %+v", marks)
	}
	for k, w := range want {
		if marks[k] != w {
			t.Errorf("history %s = %+v, want %+v", k, marks[k], w)
		}
	}

	// Access log: recent, linked to the person when the name exists.
	if r.Logins != (LoginCounts{Added: 2}) {
		t.Errorf("logins = %+v", r.Logins)
	}
	if got := count(t, db, `SELECT count(*) FROM logins l JOIN users u ON u.id = l.user_id
		WHERE u.name = 'Francesco' AND l.outcome = 'entered' AND l.address = '192.168.1.5'`); got != 1 {
		t.Error("Francesco's login is missing")
	}
	if got := count(t, db, `SELECT count(*) FROM logins WHERE name = 'hacker' AND user_id IS NULL AND outcome = 'wrong_password'`); got != 1 {
		t.Error("the wrong login is missing")
	}

	// The site's name and color, changed in the old one.
	if r.Look != LookAdded {
		t.Errorf("look = %v", r.Look)
	}
	if got := count(t, db, `SELECT count(*) FROM settings WHERE (key, value) IN
		(VALUES ('site.name_first', 'NONNA'), ('site.name_second', 'TV'), ('site.color', '#00aa55'))`); got != 3 {
		t.Error("site look not brought")
	}

	// What the new FranzPLAY cannot hold yet is counted.
	if r.LeftOut != (LeftOut{Titles: 3, Categories: 1, Photos: 1}) {
		t.Errorf("left out = %+v", r.LeftOut)
	}
	if len(r.Problems) != 0 {
		t.Errorf("problems = %v", r.Problems)
	}
}

func TestImportTwiceAddsNothing(t *testing.T) {
	db := newFranzPLAY(t)
	runImport(t, db, false)
	tables := []string{"users", "likes", "comments", "playlists", "playlist_items", "watch_progress", "logins", "closed_home_rows", "settings"}
	before := map[string]int{}
	for _, table := range tables {
		before[table] = count(t, db, `SELECT count(*) FROM `+table)
	}
	r := runImport(t, db, false)
	for _, table := range tables {
		if got := count(t, db, `SELECT count(*) FROM `+table); got != before[table] {
			t.Errorf("%s: %d rows, %d before", table, got, before[table])
		}
	}
	if len(r.People.Added) != 0 || len(r.People.Existing) != 3 || r.Likes.Added != 0 || r.Likes.Existing != 3 ||
		r.Comments.Added != 0 || r.Comments.Existing != 3 || r.Comments.Shortened != 0 || r.Saved.Added != 0 || r.Logins.Added != 0 || r.Look != LookKept {
		t.Errorf("second import = %+v", r)
	}
}

func TestImportKeepsWhatTheNewFranzPLAYAlreadyHas(t *testing.T) {
	db := newFranzPLAY(t)
	// Francesco set up the new FranzPLAY first, and watched the film further.
	exec(t, db, `INSERT INTO users (id, name, password_hash, role, created_at) VALUES (7, 'francesco', 'argon2id$new', 'admin', 0)`)
	newer := time.Date(2026, 10, 12, 21, 0, 0, 0, time.UTC).Unix()
	exec(t, db, `INSERT INTO watch_progress (user_id, video_id, position, updated_at) VALUES (7, 2, 4000, ?)`, newer)

	r := runImport(t, db, false)
	if len(r.People.Existing) != 1 || r.People.Existing[0] != "Francesco" {
		t.Errorf("existing = %v", r.People.Existing)
	}
	if got := count(t, db, `SELECT count(*) FROM users WHERE id = 7 AND password_hash = 'argon2id$new' AND accent_color IS NULL`); got != 1 {
		t.Error("the new account of Francesco was changed")
	}
	if got := count(t, db, `SELECT count(*) FROM closed_home_rows`); got != 0 {
		t.Error("old Home choices overwrote the new ones")
	}
	// His likes are now his new account's.
	if got := count(t, db, `SELECT count(*) FROM likes WHERE user_id = 7`); got != 1 {
		t.Errorf("likes of the new account = %d", got)
	}
	if got := count(t, db, `SELECT position FROM watch_progress WHERE user_id = 7 AND video_id = 2`); got != 4000 {
		t.Errorf("position = %d: the older one replaced the newer", got)
	}
}

func TestImportTryChangesNothing(t *testing.T) {
	db := newFranzPLAY(t)
	r := runImport(t, db, true)
	if !r.Try || len(r.People.Added) != 3 || r.Likes.Added != 3 {
		t.Errorf("report = %+v", r)
	}
	for _, table := range []string{"users", "likes", "comments", "playlists", "watch_progress", "logins", "settings"} {
		if got := count(t, db, `SELECT count(*) FROM `+table); got != 0 {
			t.Errorf("%s has %d rows after a try", table, got)
		}
	}
}

func TestImportNeedsTheVideos(t *testing.T) {
	db, err := database.Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close() //nolint:errcheck // test
	f, err := os.Open("testdata/mariadb-dump.sql")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close() //nolint:errcheck // read only
	if _, err := Import(context.Background(), db, f, Options{}); !errors.Is(err, ErrNoVideos) {
		t.Fatalf("err = %v, want ErrNoVideos", err)
	}
	if got := count(t, db, `SELECT count(*) FROM users`); got != 0 {
		t.Error("people were added without videos")
	}
}

func TestImportRefusesOtherDatabases(t *testing.T) {
	db := newFranzPLAY(t)
	sql := "CREATE TABLE `wp_posts` (`ID` int); INSERT INTO `wp_posts` VALUES (1);"
	if _, err := Import(context.Background(), db, strings.NewReader(sql), Options{}); !errors.Is(err, ErrNotOldFranzPLAY) {
		t.Fatalf("err = %v, want ErrNotOldFranzPLAY", err)
	}
	if _, err := Import(context.Background(), db, strings.NewReader("ciao"), Options{}); err == nil {
		t.Fatal("a text file was accepted")
	}
}

func TestImportSkipsUnreadableRows(t *testing.T) {
	db := newFranzPLAY(t)
	sql := "CREATE TABLE `Utenti` (`id` int, `Nome_Utente` varchar(9), `Password` varchar(9), `Admin` tinyint(1));\n" +
		"CREATE TABLE `Video` (`id` int, `percorso_file` varchar(9), `Titolo` varchar(9));\n" +
		"INSERT INTO `Utenti` VALUES (1, 'Giulia', '$2y$x', 0), ('due', 'Marco', '$2y$x', 0), (3, NULL, '$2y$x', 0);"
	r, err := Import(context.Background(), db, strings.NewReader(sql), Options{Now: importDay})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.People.Added) != 1 || len(r.Problems) != 2 {
		t.Errorf("added %v, problems %v", r.People.Added, r.Problems)
	}
}

func TestReportText(t *testing.T) {
	db := newFranzPLAY(t)
	r := runImport(t, db, false)
	var b strings.Builder
	if err := r.Write(&b); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"Video: 4 del vecchio FranzPLAY, 3 ritrovati nel nuovo.",
		"  - Vecchio/sparito.mp4",
		"«Al» ora si chiama «Al_»",
		"Mi piace: 3 aggiunti, 0 c'erano già, 1 lasciati fuori",
		"Nome e colore del sito: presi dal vecchio.",
		"  - 3 titoli di video cambiati a mano",
		"Si può rilanciare",
	} {
		if !strings.Contains(b.String(), want) {
			t.Errorf("report has no %q:\n%s", want, b.String())
		}
	}
}

func TestNewName(t *testing.T) {
	for _, tc := range []struct {
		old, want string
		renamed   bool
	}{
		{"Giulia", "Giulia", false},
		{" Giulia ", "Giulia", false},
		{"Al", "Al_", true},
		{"anna@casa", "anna_casa", true},
		{strings.Repeat("a", 40), strings.Repeat("a", 32), true},
	} {
		got, renamed := newName(tc.old)
		if got != tc.want || renamed != tc.renamed {
			t.Errorf("newName(%q) = %q, %v; want %q, %v", tc.old, got, renamed, tc.want, tc.renamed)
		}
	}
	if got := numbered(strings.Repeat("b", 32), 2); got != strings.Repeat("b", 30)+"_2" {
		t.Errorf("numbered = %q", got)
	}
}
