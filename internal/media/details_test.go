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
	for name, content := range map[string]string{
		"not json": "<html>",
		"too big":  `{"description": "` + strings.Repeat("x", video.MaxInfoJSONSize) + `"}`,
	} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			writeTestFile(t, root, "a.mp4", "video")
			writeTestFile(t, root, "a.info.json", content)
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
