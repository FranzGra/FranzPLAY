package media

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/content"
)

// inFolders lists the files with a name in the folders of the videos, the way
// the database saves them with no version.
func inFolders(t *testing.T, root content.Root, file string) []string {
	t.Helper()
	var names []string
	for code, folder := range videoFolders(t, root) {
		if _, err := os.Stat(filepath.Join(folder, file)); err == nil {
			names = append(names, content.Stored(code, file, ""))
		}
	}
	return names
}

// subtitlesInFolders lists the subtitles in the folders of the videos, the way
// the database saves them.
func subtitlesInFolders(t *testing.T, root content.Root) []string {
	t.Helper()
	var names []string
	for code, folder := range videoFolders(t, root) {
		for _, file := range flatFiles(t, filepath.Join(folder, "sottotitoli")) {
			names = append(names, content.Stored(code, "sottotitoli/"+file, ""))
		}
	}
	return names
}

// videoFolders returns the folders of the videos, by code.
func videoFolders(t *testing.T, root content.Root) map[string]string {
	t.Helper()
	folders := map[string]string{}
	for _, name := range flatFiles(t, root.VideoFolders()) {
		_, rest, _ := strings.Cut(name, " [")
		folders[strings.TrimSuffix(rest, "]")] = filepath.Join(root.VideoFolders(), name)
	}
	return folders
}

// flatFiles lists what is in a folder, which may not be there.
func flatFiles(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

// noVersion is a value of the database without its version.
func noVersion(value string) string {
	return content.Stored(content.CodeOf(value), content.FileOf(value), "")
}
