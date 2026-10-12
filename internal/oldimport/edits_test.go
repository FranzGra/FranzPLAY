package oldimport

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/media"
)

func TestCoverPath(t *testing.T) {
	tests := []struct {
		name                         string
		oldVideo, oldCover, newVideo string
		want                         string // "": not found
	}{
		{"the same folder", "Film/a.mp4", "Film/copertine_Film/a.jpg", "Film/a.mp4", "Film/copertine_Film/a.jpg"},
		{"the new folder is above", "Film/a.mp4", "Film/copertine_Film/a.jpg", "Video/Film/a.mp4",
			"Video/Film/copertine_Film/a.jpg"},
		{"the new folder is below", "Casa/Film/a.mp4", "Casa/Film/copertine_Film/a.jpg", "Film/a.mp4",
			"Film/copertine_Film/a.jpg"},
		{"below, cover outside the new folder", "Casa/Film/a.mp4", "copertine/a.jpg", "Film/a.mp4", ""},
		{"a folder renamed: the cover moved with it", "Vecchi/a.mp4", "Vecchi/cop/a.jpg", "Nuovi/a.mp4", "Nuovi/cop/a.jpg"},
		{"no way up", "Film/a.mp4", "Film/../../etc/passwd", "Film/a.mp4", ""},
		{"not from the root", "Film/a.mp4", "/var/www/cop/a.jpg", "Film/a.mp4", ""},
		{"no cover", "Film/a.mp4", "", "Film/a.mp4", ""},
	}
	for _, tt := range tests {
		got, ok := coverPath(tt.oldVideo, tt.oldCover, tt.newVideo)
		if got != tt.want || ok != (tt.want != "") {
			t.Errorf("%s: coverPath = %q, %v; want %q", tt.name, got, ok, tt.want)
		}
	}
}

func TestOneLine(t *testing.T) {
	if got := oneLine(" Il\nsorpasso\t", 200); got != "Il sorpasso" {
		t.Errorf("oneLine = %q", got)
	}
	if got := oneLine(strings.Repeat("a", 210), 200); len([]rune(got)) != 200 || !strings.HasSuffix(got, "…") {
		t.Errorf("a long title = %q", got)
	}
}

// aCover starts like every JPEG picture.
const aCover = "\xff\xd8\xff\xe0 the film's cover"

// coverFixture is the fixture's old database where the administrator
// chose the cover of the film by hand, and of Tom & Jerry, whose file
// is gone. The new video folder holds the film's cover, where the old
// FranzPLAY left it.
func coverFixture(t *testing.T, db *sql.DB) string {
	t.Helper()
	data, err := os.ReadFile("testdata/mariadb-dump.sql")
	if err != nil {
		t.Fatal(err)
	}
	dump := strings.Replace(string(data),
		`(2,'Film/Il sorpasso (1962).mp4','Il sorpasso',2,NULL,0,'1:45','mp4',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`,
		`(2,'Film/Il sorpasso (1962).mp4','Il sorpasso',2,NULL,0,'1:45','mp4','Film/copertine_Film/Il sorpasso (1962).jpg',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'manuale',NULL)`, 1)
	dump = strings.Replace(dump,
		`(4,'Tom & Jerry #2.mp4','Tom & Jerry',NULL,NULL,1,'07:00','mp4',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`,
		`(4,'Tom & Jerry #2.mp4','Tom & Jerry',NULL,NULL,1,'07:00','mp4','copertine/Tom.jpg',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'manuale',NULL)`, 1)
	if !strings.Contains(dump, "'manuale',NULL),\n(3") || !strings.Contains(dump, "'copertine/Tom.jpg'") {
		t.Fatal("the fixture changed: update this test")
	}
	library := t.TempDir()
	exec(t, db, `UPDATE libraries SET path = ? WHERE id = 1`, library)
	cover := filepath.Join(library, "Film", "copertine_Film", "Il sorpasso (1962).jpg")
	if err := os.MkdirAll(filepath.Dir(cover), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cover, []byte(aCover), 0o600); err != nil {
		t.Fatal(err)
	}
	return dump
}

func TestImportCovers(t *testing.T) {
	db := newFranzPLAY(t)
	dump := coverFixture(t, db)
	dataDir := t.TempDir()
	run := func(try bool) *Report {
		t.Helper()
		r, err := Import(context.Background(), db, strings.NewReader(dump), Options{Try: try, Now: importDay, DataDir: dataDir})
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	ownCovers := func() []os.DirEntry {
		entries, err := os.ReadDir(filepath.Join(dataDir, media.OwnCoversDir))
		if err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
		return entries
	}

	// A try only reads the covers.
	if r := run(true); r.Covers.Added != 1 || len(r.Covers.Failed) != 1 || len(ownCovers()) != 0 {
		t.Fatalf("try: covers = %+v, %d files", r.Covers, len(ownCovers()))
	}

	r := run(false)
	if r.Covers.Added != 1 || len(r.Covers.Failed) != 1 || !strings.Contains(r.Covers.Failed[0], "Tom & Jerry #2.mp4") {
		t.Fatalf("covers = %+v", r.Covers)
	}
	var own string
	if err := db.QueryRow(`SELECT own_cover FROM videos WHERE id = 2`).Scan(&own); err != nil {
		t.Fatal(err)
	}
	copied, err := os.ReadFile(filepath.Join(dataDir, media.OwnCoversDir, own))
	if err != nil || string(copied) != aCover || !strings.HasSuffix(own, ".jpg") {
		t.Errorf("copy %s = %q, %v", own, copied, err)
	}
	if got := count(t, db, `SELECT count(*) FROM jobs WHERE video_id = 2 AND kind = 'cover' AND state = 'pending'`); got != 1 {
		t.Error("no new cover asked for")
	}

	// Again: the video has its cover, and no second copy stays.
	if r := run(false); r.Covers.Existing != 1 || r.Covers.Added != 0 || len(ownCovers()) != 1 {
		t.Errorf("second import: covers = %+v, %d files", r.Covers, len(ownCovers()))
	}

	var b strings.Builder
	if err := r.Write(&b); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(b.String(), "Copertine scelte a mano: 1 aggiunte") {
		t.Errorf("report:\n%s", b.String())
	}
}
