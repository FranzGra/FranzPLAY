package library

import (
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"testing"
	"testing/fstest"
	"time"
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
