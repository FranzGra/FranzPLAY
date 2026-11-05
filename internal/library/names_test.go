package library

import (
	"context"
	"maps"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/titles"
)

func TestCategoryNames(t *testing.T) {
	keys := []string{
		"Cartella Raccoglitore/Categoria 1",
		"Cartella Raccoglitore/Categoria 2",
		"Categoria 4",
		"Serie A/Stagione 1",
		"Serie B/Stagione 1",
		"X/Serie/Stagione 2",
		"Y/Serie/Stagione 2",
		"Film",
		"Archivio/Film",
	}
	want := map[string]string{
		"Cartella Raccoglitore/Categoria 1": "Categoria 1",
		"Cartella Raccoglitore/Categoria 2": "Categoria 2",
		"Categoria 4":                       "Categoria 4",
		"Serie A/Stagione 1":                "Serie A › Stagione 1",
		"Serie B/Stagione 1":                "Serie B › Stagione 1",
		"X/Serie/Stagione 2":                "X › Serie › Stagione 2",
		"Y/Serie/Stagione 2":                "Y › Serie › Stagione 2",
		// "Film" has nothing above: it stays "Film", the other one shows
		// its parent.
		"Film":          "Film",
		"Archivio/Film": "Archivio › Film",
	}
	if got := categoryNames(keys, nil); !maps.Equal(got, want) {
		t.Errorf("categoryNames =\n %v\nwant\n %v", got, want)
	}

	// With the rules on the categories too, each folder's name is cleaned.
	s, err := titles.Settings{Categories: true, Rules: []titles.Rule{{Find: "_", Replace: " ", On: true}}}.Clean()
	if err != nil {
		t.Fatal(err)
	}
	clean, err := s.Compile()
	if err != nil {
		t.Fatal(err)
	}
	got := categoryNames([]string{"Cartoni_animati", "Raccolta/Film_2024"}, clean)
	if got["Cartoni_animati"] != "Cartoni animati" || got["Raccolta/Film_2024"] != "Film 2024" {
		t.Errorf("cleaned names = %v", got)
	}
}

// categoryRows is the folder_categories table.
func (ts *testScanner) categoryRows(t *testing.T) map[string]string {
	t.Helper()
	rows, err := ts.db.Query(`SELECT name, shown FROM folder_categories`)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rows.Close() }()
	out := map[string]string{}
	for rows.Next() {
		var name, shown string
		if err := rows.Scan(&name, &shown); err != nil {
			t.Fatal(err)
		}
		out[name] = shown
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// TestScanMakesACategoryOfEveryFolderWithVideos is the example of the
// administrator: a folder that only holds other folders is not a category;
// every folder with videos of its own is one, at any depth.
func TestScanMakesACategoryOfEveryFolderWithVideos(t *testing.T) {
	lib := t.TempDir()
	writeFile(t, lib, "Cartella Raccoglitore/Categoria 1/a.mp4", "a")
	writeFile(t, lib, "Cartella Raccoglitore/Categoria 2/b.mp4", "b")
	writeFile(t, lib, "Cartella Raccoglitore/Categoria 3/c.mp4", "c")
	writeFile(t, lib, "Categoria 4/d.mp4", "d")
	writeFile(t, lib, "Categoria 4/Extra/e.mp4", "e") // its own videos and a sub-folder
	writeFile(t, lib, "Cartella Raccoglitore/poster.jpg", "not a category")
	writeFile(t, lib, "Cartella Raccoglitore/Categoria 2/poster.jpg", "the poster of a deep category")
	ts := newTestScanner(t, lib)

	ts.scan(t, Report{Added: 5})

	got := ts.videos(t)
	for path, want := range map[string]string{
		"Cartella Raccoglitore/Categoria 1/a.mp4": "Cartella Raccoglitore/Categoria 1",
		"Cartella Raccoglitore/Categoria 2/b.mp4": "Cartella Raccoglitore/Categoria 2",
		"Cartella Raccoglitore/Categoria 3/c.mp4": "Cartella Raccoglitore/Categoria 3",
		"Categoria 4/d.mp4":                       "Categoria 4",
		"Categoria 4/Extra/e.mp4":                 "Categoria 4/Extra",
	} {
		if got[path].category != want {
			t.Errorf("%s: category %q, want %q", path, got[path].category, want)
		}
	}
	wantNames := map[string]string{
		"Cartella Raccoglitore/Categoria 1": "Categoria 1",
		"Cartella Raccoglitore/Categoria 2": "Categoria 2",
		"Cartella Raccoglitore/Categoria 3": "Categoria 3",
		"Categoria 4":                       "Categoria 4",
		"Categoria 4/Extra":                 "Extra",
	}
	if names := ts.categoryRows(t); !maps.Equal(names, wantNames) {
		t.Errorf("names = %v, want %v", names, wantNames)
	}
	if pics := ts.pictures(t); len(pics) != 1 || !pics["Cartella Raccoglitore/Categoria 2/poster.jpg"] {
		t.Errorf("category pictures = %v, want only the one of Categoria 2", pics)
	}

	// A folder taken away: its name goes too.
	move(t, lib, "Categoria 4/Extra/e.mp4", "Categoria 4/e.mp4")
	ts.scan(t, Report{Moved: 1, Unchanged: 4})
	delete(wantNames, "Categoria 4/Extra")
	if names := ts.categoryRows(t); !maps.Equal(names, wantNames) {
		t.Errorf("after the move: names = %v, want %v", names, wantNames)
	}
}

// TestScanMovesOldCategoriesToTheNewRule: a catalog made when the
// category was the first folder gets the folder of each video at the first
// scan, without reading any file again, and keeps its videos (the same ids).
func TestScanMovesOldCategoriesToTheNewRule(t *testing.T) {
	lib := t.TempDir()
	writeFile(t, lib, "Viaggi/2025/Sardegna.mkv", "sardinia")
	ts := newTestScanner(t, lib)
	ts.scan(t, Report{Added: 1})
	before := ts.videos(t)["Viaggi/2025/Sardegna.mkv"]
	// As an older FranzPLAY left it.
	if _, err := ts.db.Exec(`UPDATE videos SET folder_category = 'Viaggi'`); err != nil {
		t.Fatal(err)
	}
	if _, err := ts.db.Exec(`DELETE FROM folder_categories`); err != nil {
		t.Fatal(err)
	}

	// A new start of FranzPLAY: a new scanner on the same catalog.
	now := ts.now
	ts.Scanner = NewScanner(ts.db, []string{lib}, ts.logger)
	ts.now = now
	ts.scan(t, Report{Unchanged: 1})

	after := ts.videos(t)["Viaggi/2025/Sardegna.mkv"]
	if after.id != before.id || after.category != "Viaggi/2025" {
		t.Errorf("after the first scan: %+v, want id %d and category Viaggi/2025", after, before.id)
	}
	if names := ts.categoryRows(t); names["Viaggi/2025"] != "2025" {
		t.Errorf("names = %v", names)
	}
}

// TestRulesChangeTheTitlesWithoutAScan: saving rules makes the titles
// again at once, from the paths already known. A title written by the
// administrator stays, and the files are never touched.
func TestRulesChangeTheTitlesWithoutAScan(t *testing.T) {
	lib := t.TempDir()
	writeFile(t, lib, "Film/Il_mio_video_[1080p].mp4", "a")
	writeFile(t, lib, "Film/Altro_video.mkv", "b")
	ts := newTestScanner(t, lib)
	ts.scan(t, Report{Added: 2})
	if _, err := ts.db.Exec(`UPDATE videos SET admin_title = 'Scelto a mano' WHERE path = 'Film/Altro_video.mkv'`); err != nil {
		t.Fatal(err)
	}
	files := snapshot(t, lib)

	rules := titles.Settings{}
	for _, p := range titles.Presets {
		rules.Rules = append(rules.Rules, p.Rule)
	}
	rules, err := rules.Clean()
	if err != nil {
		t.Fatal(err)
	}
	if err := titles.Save(context.Background(), ts.db, rules); err != nil {
		t.Fatal(err)
	}
	changed := 0
	ts.OnChange(func() { changed++ })
	n, err := ts.Retitle(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 || changed != 1 {
		t.Errorf("Retitle changed %d videos and told the pages %d times, want 2 and 1", n, changed)
	}
	shown := func(path string) string {
		t.Helper()
		var s string
		if err := ts.db.QueryRow(`SELECT shown_title FROM videos WHERE path = ?`, path).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	if got := shown("Film/Il_mio_video_[1080p].mp4"); got != "Il mio video" {
		t.Errorf("title = %q, want %q", got, "Il mio video")
	}
	if got := shown("Film/Altro_video.mkv"); got != "Scelto a mano" {
		t.Errorf("the title written by hand became %q", got)
	}
	sameSnapshot(t, files, snapshot(t, lib))

	// The next scan sees the same rules: nothing to do again.
	ts.scan(t, Report{Unchanged: 2})
	if got := shown("Film/Il_mio_video_[1080p].mp4"); got != "Il mio video" {
		t.Errorf("after a scan: title = %q", got)
	}

	// Rules taken away: the names of the files come back.
	if err := titles.Save(context.Background(), ts.db, titles.Settings{Rules: []titles.Rule{}}); err != nil {
		t.Fatal(err)
	}
	if _, err := ts.Retitle(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := shown("Film/Il_mio_video_[1080p].mp4"); got != "Il_mio_video_[1080p]" {
		t.Errorf("without rules: title = %q", got)
	}
}
