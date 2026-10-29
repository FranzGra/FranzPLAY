package library

import (
	"maps"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/video"
)

func paths(files []found) []string {
	var out []string
	for _, f := range files {
		out = append(out, f.loc.path)
	}
	slices.Sort(out)
	return out
}

func TestListFindsVideosOnly(t *testing.T) {
	mod := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	fsys := fstest.MapFS{
		"mare.mp4":                      {Data: []byte("12345"), ModTime: mod},
		"Viaggi/2025/montagna.MKV":      {Data: []byte("x")},
		"Viaggi/copertina.jpg":          {Data: []byte("x")},
		"Viaggi/montagna.srt":           {Data: []byte("x")},
		".nascosta/segreto.mp4":         {Data: []byte("x")},
		"@eaDir/mare.mp4/SYNOVIDEO.mp4": {Data: []byte("x")},
		"._mare.mp4":                    {Data: []byte("x")},
		"Corsi/lezione.webm":            {Data: []byte("x")},
	}

	l := list(fsys, 7)

	if !l.complete() {
		t.Fatalf("unexpected problems: %v", l.err())
	}
	want := []string{"Corsi/lezione.webm", "Viaggi/2025/montagna.MKV", "mare.mp4"}
	if got := paths(l.files); !slices.Equal(got, want) {
		t.Errorf("found %q, want %q", got, want)
	}
	for _, f := range l.files {
		if f.loc.library != 7 {
			t.Errorf("%s: library = %d, want 7", f.loc.path, f.loc.library)
		}
		if f.loc.path == "mare.mp4" && (f.size != 5 || f.modTime != mod.UnixNano()) {
			t.Errorf("mare.mp4: size %d time %d, want 5 and %d", f.size, f.modTime, mod.UnixNano())
		}
	}
}

func TestListMissingLibraryIsIncomplete(t *testing.T) {
	l := list(os.DirFS(filepath.Join(t.TempDir(), "not-mounted")), 1)
	if l.complete() || len(l.files) != 0 {
		t.Errorf("listing of a missing folder: complete=%v files=%v", l.complete(), l.files)
	}
}

func TestListUnreadableFolderIsIncomplete(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("needs Unix permissions and a normal user")
	}
	root := t.TempDir()
	writeFile(t, root, "ok.mp4", "x")
	writeFile(t, root, "locked/hidden.mp4", "x")
	lockDir(t, filepath.Join(root, "locked"), 0o000)

	l := list(os.DirFS(root), 1)

	if l.complete() {
		t.Error("listing with an unreadable folder says it is complete")
	}
	if got := paths(l.files); !slices.Equal(got, []string{"ok.mp4"}) {
		t.Errorf("found %q, want the readable video anyway", got)
	}
}

func TestListSkipsSymlinks(t *testing.T) {
	root := t.TempDir()
	writeFile(t, root, "real.mp4", "x")
	if err := os.Symlink(filepath.Join(root, "real.mp4"), filepath.Join(root, "link.mp4")); err != nil {
		t.Skipf("cannot create symlinks here: %v", err)
	}
	l := list(os.DirFS(root), 1)
	if got := paths(l.files); !slices.Equal(got, []string{"real.mp4"}) {
		t.Errorf("found %q, want only the real file", got)
	}
}

// writeFile creates root/rel with the given content, making folders as needed.
func writeFile(t *testing.T, root, rel, data string) string {
	t.Helper()
	name := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(name), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}
	return name
}

// lockDir changes a folder's permissions and restores them at the end of
// the test, so the temporary folder can be cleaned up.
func lockDir(t *testing.T, dir string, mode os.FileMode) {
	t.Helper()
	if err := os.Chmod(dir, mode); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chmod(dir, 0o750); err != nil {
			t.Error(err)
		}
	})
}

func TestListCoverImages(t *testing.T) {
	mod := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	fsys := fstest.MapFS{
		"mare.mp4":                   {Data: []byte("x")},
		"mare.jpg":                   {Data: []byte("x"), ModTime: mod},
		"Viaggi/montagna.mkv":        {Data: []byte("x")},
		"Viaggi/MONTAGNA-POSTER.PNG": {Data: []byte("xy"), ModTime: mod},
		"Viaggi/lago.mp4":            {Data: []byte("x")},
		"Viaggi/poster.jpg":          {Data: []byte("x")},
		"Altro/mare.mp4":             {Data: []byte("x")}, // mare.jpg is in another folder
		".nascosta/mare.jpg":         {Data: []byte("x")},
	}

	covers := list(fsys, 1).coverImages()

	want := map[string]string{
		"mare.mp4":            video.ImageVersion("mare.jpg", 1, mod.UnixNano()),
		"Viaggi/montagna.mkv": video.ImageVersion("MONTAGNA-POSTER.PNG", 2, mod.UnixNano()),
		"Viaggi/lago.mp4":     "",
		"Altro/mare.mp4":      "",
	}
	if !maps.Equal(covers, want) {
		t.Errorf("coverImages = %q, want %q", covers, want)
	}
}

func TestListCategoryPictures(t *testing.T) {
	mod := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	fsys := fstest.MapFS{
		"poster.jpg":             {Data: []byte("x")}, // the library itself is no category
		"Viaggi/mare.mp4":        {Data: []byte("x")},
		"Viaggi/Poster.JPG":      {Data: []byte("xy"), ModTime: mod},
		"Viaggi/fanart.webp":     {Data: []byte("x")},
		"Viaggi/mare.jpg":        {Data: []byte("x")},
		"Viaggi/2025/poster.jpg": {Data: []byte("x")}, // a sub-folder is no category
		"Corsi/lezione.webm":     {Data: []byte("x")},
		"Corsi/._poster.jpg":     {Data: []byte("x")},
		".nascosta/poster.jpg":   {Data: []byte("x")},
	}

	got := list(fsys, 1).categoryPictures()
	slices.SortFunc(got, func(a, b categoryPicture) int { return strings.Compare(a.path, b.path) })

	want := []categoryPicture{
		{path: "Viaggi/Poster.JPG", category: "Viaggi", size: 2, modTime: mod.UnixNano()},
		{path: "Viaggi/fanart.webp", category: "Viaggi", size: 1},
	}
	if len(got) != len(want) {
		t.Fatalf("categoryPictures = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i].path != want[i].path || got[i].category != want[i].category || got[i].size != want[i].size ||
			(want[i].modTime != 0 && got[i].modTime != want[i].modTime) {
			t.Errorf("picture %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}
