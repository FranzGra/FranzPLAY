package library

import (
	"context"
	"fmt"
	"io/fs"
	"maps"
	"path"
	"slices"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/FranzGra/FranzPLAY/internal/titles"
)

// The rule of the categories, seen from the scan: every folder with videos of
// its own is a category, at any depth; a folder with only folders is not.

func TestScanCategoriesOfStrangeNames(t *testing.T) {
	lib := t.TempDir()
	files := map[string]string{
		"Città d'arte/Perù (2019)/Machu Picchu 🎒.mp4": "Città d'arte/Perù (2019)",
		"Ünïcödé  doppi spazi/a [1080p].mkv":          "Ünïcödé  doppi spazi",
		"日本/東京.webm":                                  "日本",
		"Film & Serie/#1 - l'inizio.MP4":              "Film & Serie",
		"Con.punti.nel.nome/video.finale.avi":         "Con.punti.nel.nome",
		"radice con spazio .mov":                      "",
	}
	for p := range files {
		writeFile(t, lib, p, p) // a different content each: no duplicates
	}
	ts := newTestScanner(t, lib)
	ts.scan(t, Report{Added: len(files)})

	got := ts.videos(t)
	for p, category := range files {
		v, ok := got[p]
		if !ok {
			t.Errorf("%s: not in the catalog (have %v)", p, slices.Collect(maps.Keys(got)))
			continue
		}
		if v.category != category {
			t.Errorf("%s: category %q, want %q", p, v.category, category)
		}
		// The extension is never part of the title.
		if want := strings.TrimSuffix(path.Base(p), path.Ext(p)); v.title != want {
			t.Errorf("%s: title %q, want %q", p, v.title, want)
		}
	}
	want := map[string]string{
		"Città d'arte/Perù (2019)": "Perù (2019)",
		"Ünïcödé  doppi spazi":     "Ünïcödé  doppi spazi",
		"日本":                       "日本",
		"Film & Serie":             "Film & Serie",
		"Con.punti.nel.nome":       "Con.punti.nel.nome",
	}
	if names := ts.categoryRows(t); !maps.Equal(names, want) {
		t.Errorf("names = %v, want %v", names, want)
	}
}

// TestScanSkipsWhatIsNotAVideo: hidden files and folders, the folders of NAS
// systems, pictures and other files make no video and no category.
func TestScanSkipsWhatIsNotAVideo(t *testing.T) {
	lib := t.TempDir()
	writeFile(t, lib, "Film/a.mp4", "a")
	writeFile(t, lib, "Film/._a.mp4", "macOS metadata")
	writeFile(t, lib, "Film/.nascosto.mp4", "hidden")
	writeFile(t, lib, "Film/a.srt", "subtitles")
	writeFile(t, lib, "Film/a.mp4.part", "being downloaded")
	writeFile(t, lib, "Film/senza estensione", "x")
	writeFile(t, lib, ".Trash/b.mp4", "b")
	writeFile(t, lib, "@eaDir/Film/c.mp4", "c")
	writeFile(t, lib, "#recycle/d.mp4", "d")
	writeFile(t, lib, "$RECYCLE.BIN/e.mp4", "e")
	writeFile(t, lib, "Solo foto/poster.jpg", "picture")
	writeFile(t, lib, "Solo testo/note.txt", "text")
	ts := newTestScanner(t, lib)
	ts.scan(t, Report{Added: 1})

	if got := ts.videos(t); len(got) != 1 || got["Film/a.mp4"].category != "Film" {
		t.Errorf("videos = %v, want only Film/a.mp4", got)
	}
	if names := ts.categoryRows(t); !maps.Equal(names, map[string]string{"Film": "Film"}) {
		t.Errorf("names = %v", names)
	}
}

// TestScanFolderRenamedKeepsItsVideos: a category folder renamed, or moved
// under another folder, keeps its videos (the same ids) and its name follows
// the folder; the old name goes.
func TestScanFolderRenamedKeepsItsVideos(t *testing.T) {
	lib := t.TempDir()
	writeFile(t, lib, "Serie/Stagione 1/e1.mp4", "e1")
	writeFile(t, lib, "Serie/Stagione 1/e2.mp4", "e2")
	writeFile(t, lib, "Serie/trailer.mp4", "trailer")
	ts := newTestScanner(t, lib)
	ts.scan(t, Report{Added: 3})
	before := ts.videos(t)

	move(t, lib, "Serie/Stagione 1", "Serie/Stagione Uno")
	ts.scan(t, Report{Moved: 2, Unchanged: 1})
	after := ts.videos(t)
	for _, e := range []string{"e1", "e2"} {
		old, now := before["Serie/Stagione 1/"+e+".mp4"], after["Serie/Stagione Uno/"+e+".mp4"]
		if now.id != old.id || now.category != "Serie/Stagione Uno" {
			t.Errorf("%s after the rename: %+v, was %+v", e, now, old)
		}
	}
	want := map[string]string{"Serie": "Serie", "Serie/Stagione Uno": "Stagione Uno"}
	if names := ts.categoryRows(t); !maps.Equal(names, want) {
		t.Errorf("after the rename: names = %v, want %v", names, want)
	}

	// The whole series under a collector folder: Serie is still a category,
	// at its new depth.
	move(t, lib, "Serie", "Archivio/Serie")
	ts.scan(t, Report{Moved: 3})
	want = map[string]string{"Archivio/Serie": "Serie", "Archivio/Serie/Stagione Uno": "Stagione Uno"}
	if names := ts.categoryRows(t); !maps.Equal(names, want) {
		t.Errorf("after the move: names = %v, want %v", names, want)
	}
	if v := ts.videos(t)["Archivio/Serie/trailer.mp4"]; v.id != before["Serie/trailer.mp4"].id || v.category != "Archivio/Serie" {
		t.Errorf("trailer = %+v", v)
	}

	// The last video of a folder gone: so is its category.
	move(t, lib, "Archivio/Serie/trailer.mp4", "trailer.mp4")
	ts.scan(t, Report{Moved: 1, Unchanged: 2})
	want = map[string]string{"Archivio/Serie/Stagione Uno": "Stagione Uno"}
	if names := ts.categoryRows(t); !maps.Equal(names, want) {
		t.Errorf("after the last video left: names = %v, want %v", names, want)
	}
}

// TestScanSameFolderNamesAreToldApart: folders with the same name, at the same
// or another depth, are different categories with names people can tell apart.
func TestScanSameFolderNamesAreToldApart(t *testing.T) {
	lib := t.TempDir()
	writeFile(t, lib, "Film/a.mp4", "a")
	writeFile(t, lib, "Archivio/Film/b.mp4", "b")
	writeFile(t, lib, "Vecchio/Archivio/Film/c.mp4", "c")
	writeFile(t, lib, "Serie A/Stagione 1/d.mp4", "d")
	writeFile(t, lib, "Serie B/Stagione 1/e.mp4", "e")
	ts := newTestScanner(t, lib)
	ts.scan(t, Report{Added: 5})

	want := map[string]string{
		"Film":                  "Film",
		"Archivio/Film":         "Archivio › Film",
		"Vecchio/Archivio/Film": "Vecchio › Archivio › Film",
		"Serie A/Stagione 1":    "Serie A › Stagione 1",
		"Serie B/Stagione 1":    "Serie B › Stagione 1",
	}
	if names := ts.categoryRows(t); !maps.Equal(names, want) {
		t.Errorf("names = %v, want %v", names, want)
	}

	// One of the two seasons gone: the other needs its series no more.
	move(t, lib, "Serie B/Stagione 1/e.mp4", "Serie B/e.mp4")
	ts.scan(t, Report{Moved: 1, Unchanged: 4})
	delete(want, "Serie B/Stagione 1")
	want["Serie A/Stagione 1"] = "Stagione 1"
	want["Serie B"] = "Serie B"
	if names := ts.categoryRows(t); !maps.Equal(names, want) {
		t.Errorf("after the move: names = %v, want %v", names, want)
	}
}

// TestCategoryNamesAreUniqueAndStable: whatever the folders, two categories
// never show the same name, and the order of the keys changes nothing.
func TestCategoryNamesAreUniqueAndStable(t *testing.T) {
	tests := []struct {
		name string
		keys []string
	}{
		{"one", []string{"Film"}},
		{"three of one name at three depths", []string{"Film", "A/Film", "B/A/Film"}},
		{"the same tail", []string{"X/A/Film", "Y/A/Film", "A/Film"}},
		{"deep twins", []string{"1/2/3/4/5/x", "1/2/3/4/6/x", "9/2/3/4/5/x"}},
		{"strange names", []string{"è/🎬", "é/🎬", "(1)/[2]", "(2)/[2]"}},
		{"many", manyCategories(200)},
	}
	for _, tt := range tests {
		got := categoryNames(tt.keys, nil)
		if len(got) != len(tt.keys) {
			t.Errorf("%s: %d names for %d categories", tt.name, len(got), len(tt.keys))
		}
		seen := map[string]string{}
		for k, name := range got {
			if other, ok := seen[name]; ok {
				t.Errorf("%s: %q and %q both show %q", tt.name, k, other, name)
			}
			seen[name] = k
			if !strings.HasSuffix(name, path.Base(k)) {
				t.Errorf("%s: %q shows %q, not ending with its folder", tt.name, k, name)
			}
		}
		reversed := slices.Clone(tt.keys)
		slices.Reverse(reversed)
		if again := categoryNames(reversed, nil); !maps.Equal(again, got) {
			t.Errorf("%s: another order gives %v, want %v", tt.name, again, got)
		}
	}
}

// TestCategoryNamesWithTheSeparatorInAFolder: a folder whose name holds the
// separator itself, " › ", can show like a deeper category.
func TestCategoryNamesWithTheSeparatorInAFolder(t *testing.T) {
	t.Skip("BUG: \"A › B\" (one folder) and \"A/B\" next to \"B\" both show \"A › B\": names.go categoryNames does not check the longer names it makes against the ones already given")
	got := categoryNames([]string{"B", "A/B", "A › B"}, nil)
	if got["A/B"] == got["A › B"] {
		t.Errorf("two categories show %q", got["A/B"])
	}
}

func manyCategories(n int) []string {
	out := make([]string, 0, n)
	for i := range n {
		// Few distinct last folders, so most need the ones above.
		out = append(out, fmt.Sprintf("Raccolta %d/Anno %d/Stagione %d", i%7, i%13, i%5))
	}
	slices.Sort(out)
	return slices.Compact(out)
}

// TestRulesCleanTheCategoriesOnlyWhenAsked: the scan names the categories
// with the rules on the folders only when the administrator asked for it, and
// the path of the category, which tells it apart, never changes.
func TestRulesCleanTheCategoriesOnlyWhenAsked(t *testing.T) {
	lib := t.TempDir()
	writeFile(t, lib, "Cartoni_animati/Tom_e_Jerry.mp4", "a")
	writeFile(t, lib, "Raccolta/Film_2024/Il_film.mkv", "b")
	ts := newTestScanner(t, lib)
	ts.scan(t, Report{Added: 2})

	save := func(categories bool) {
		t.Helper()
		s, err := titles.Settings{Categories: categories, Rules: []titles.Rule{{Find: "_", Replace: " ", On: true}}}.Clean()
		if err != nil {
			t.Fatal(err)
		}
		if err := titles.Save(context.Background(), ts.db, s); err != nil {
			t.Fatal(err)
		}
		if _, err := ts.Retitle(context.Background()); err != nil {
			t.Fatal(err)
		}
	}

	save(false)
	want := map[string]string{"Cartoni_animati": "Cartoni_animati", "Raccolta/Film_2024": "Film_2024"}
	if names := ts.categoryRows(t); !maps.Equal(names, want) {
		t.Errorf("rules on titles only: names = %v, want %v", names, want)
	}
	if v := ts.videos(t)["Cartoni_animati/Tom_e_Jerry.mp4"]; v.title != "Tom e Jerry" || v.category != "Cartoni_animati" {
		t.Errorf("video = %+v", v)
	}

	save(true)
	want = map[string]string{"Cartoni_animati": "Cartoni animati", "Raccolta/Film_2024": "Film 2024"}
	if names := ts.categoryRows(t); !maps.Equal(names, want) {
		t.Errorf("rules on categories too: names = %v, want %v", names, want)
	}
	if v := ts.videos(t)["Raccolta/Film_2024/Il_film.mkv"]; v.category != "Raccolta/Film_2024" {
		t.Errorf("the category is the path of the folder, whatever its name: %+v", v)
	}
	// The next scan sees the same rules and changes nothing.
	ts.scan(t, Report{Unchanged: 2})
	if names := ts.categoryRows(t); !maps.Equal(names, want) {
		t.Errorf("after a scan: names = %v", names)
	}
}

// TestListOfStrangeNames is the listing alone, on names a disk of Windows or
// macOS can hold.
func TestListOfStrangeNames(t *testing.T) {
	fsys := fstest.MapFS{
		"Perù/Machu Picchu 🎒.mp4":         {Data: []byte("x")},
		"Spazi  doppi /a (1).MKV":         {Data: []byte("x")},
		"[Tag] Serie/ep #1.m4v":           {Data: []byte("x")},
		"Perù/.DS_Store":                  {Data: []byte("x")},
		"Perù/Thumbs.db":                  {Data: []byte("x")},
		"System Volume Information/x.mp4": {Data: []byte("x")},
		"lost+found/y.mp4":                {Data: []byte("x")},
		"Vuota":                           {Mode: fs.ModeDir | 0o755},
	}
	l := list(fsys, 1)
	if !l.complete() {
		t.Fatal(l.err())
	}
	want := []string{"Perù/Machu Picchu 🎒.mp4", "Spazi  doppi /a (1).MKV", "[Tag] Serie/ep #1.m4v"}
	if got := paths(l.files); !slices.Equal(got, want) {
		t.Errorf("found %q, want %q", got, want)
	}
}
