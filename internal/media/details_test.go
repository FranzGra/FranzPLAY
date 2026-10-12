package media

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// shownDetails reads what the catalog shows of a video.
type shownDetails struct {
	shownTitle                             string
	detailsTitle, description, author, day sql.NullString
}

func readShown(t *testing.T, db *sql.DB, id int64) shownDetails {
	t.Helper()
	var d shownDetails
	if err := db.QueryRow(`SELECT shown_title, details_title, description, author, published_on FROM videos WHERE id = ?`, id).
		Scan(&d.shownTitle, &d.detailsTitle, &d.description, &d.author, &d.day); err != nil {
		t.Fatal(err)
	}
	return d
}

func TestDetailsFromTheFileOfYtDlp(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, root, "gita [abc123].mp4", "video")
	writeTestFile(t, root, "gita [abc123].info.json",
		`{"title": "Gita in montagna", "description": "Che giornata!", "channel": "Famiglia Rossi", "upload_date": "20190315"}`)
	db, id := catalog(t, root, "gita [abc123].mp4")
	d := NewDetailer(db)
	before := listDir(t, root)

	if err := d.Handle(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	got := readShown(t, db, id)
	if got.shownTitle != "Gita in montagna" || got.description.String != "Che giornata!" ||
		got.author.String != "Famiglia Rossi" || got.day.String != "2019-03-15" {
		t.Errorf("details = %+v", got)
	}
	if after := listDir(t, root); !slices.Equal(after, before) {
		t.Errorf("video folder = %v, want untouched %v", after, before)
	}

	// The file goes away: so do its details, and the name's title is back.
	if err := os.Remove(filepath.Join(root, "gita [abc123].info.json")); err != nil {
		t.Fatal(err)
	}
	if err := d.Handle(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	got = readShown(t, db, id)
	if got.shownTitle != "t" || got.detailsTitle.Valid || got.description.Valid || got.author.Valid || got.day.Valid {
		t.Errorf("without the file = %+v, want no details", got)
	}
}

func TestDetailsFileThatCannotBeRead(t *testing.T) {
	tests := []struct {
		name, file, content string
	}{
		{"not json", "a.info.json", "<html>"},
		{"too big", "a.info.json", `{"description": "` + strings.Repeat("x", video.MaxInfoJSONSize) + `"}`},
		{"not xml", "a.nfo", "<movie><title>"},
		{"nfo too big", "a.nfo", "<movie><plot>" + strings.Repeat("x", video.MaxNFOSize) + "</plot></movie>"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := t.TempDir()
			writeTestFile(t, root, "a.mp4", "video")
			writeTestFile(t, root, tt.file, tt.content)
			db, id := catalog(t, root, "a.mp4")
			err := NewDetailer(db).Handle(context.Background(), id)
			if !errors.Is(err, jobs.ErrPermanent) {
				t.Errorf("error = %v, want a permanent failure", err)
			}
		})
	}
}

func writeTestFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestDetailsFromTheFileOfKodi(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, root, "viaggio.mkv", "video")
	writeTestFile(t, root, "viaggio.nfo",
		`<movie><title>Il viaggio</title><plot>Fino al mare.</plot><director>Anna</director><premiered>2001-05-20</premiered></movie>`)
	db, id := catalog(t, root, "viaggio.mkv")
	before := listDir(t, root)

	if err := NewDetailer(db).Handle(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	got := readShown(t, db, id)
	if got.shownTitle != "Il viaggio" || got.description.String != "Fino al mare." ||
		got.author.String != "Anna" || got.day.String != "2001-05-20" {
		t.Errorf("details = %+v", got)
	}
	if after := listDir(t, root); !slices.Equal(after, before) {
		t.Errorf("video folder = %v, want untouched %v", after, before)
	}
}

func TestDetailsFromBothFiles(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, root, "gita.mp4", "video")
	writeTestFile(t, root, "gita.info.json", `{"title": "Dal file di yt-dlp", "upload_date": "20190315"}`)
	writeTestFile(t, root, "gita.nfo", `<episodedetails><title>Dal file di Kodi</title><showtitle>Famiglia Rossi</showtitle></episodedetails>`)
	db, id := catalog(t, root, "gita.mp4")

	if err := NewDetailer(db).Handle(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	// yt-dlp's file comes first; Kodi's fills what it does not say.
	got := readShown(t, db, id)
	if got.shownTitle != "Dal file di yt-dlp" || got.author.String != "Famiglia Rossi" || got.day.String != "2019-03-15" {
		t.Errorf("details = %+v", got)
	}
}
