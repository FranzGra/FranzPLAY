package content

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// folders is every folder of a Root, by the name of its method.
func folders(r Root) map[string]string {
	return map[string]string{
		"Covers":           r.Covers(),
		"OwnCovers":        r.OwnCovers(),
		"Previews":         r.Previews(),
		"Clips":            r.Clips(),
		"ClipsHD":          r.ClipsHD(),
		"OwnClips":         r.OwnClips(),
		"Converted":        r.Converted(),
		"Subtitles":        r.Subtitles(),
		"AutoSubtitles":    r.AutoSubtitles(),
		"WhisperModels":    r.WhisperModels(),
		"TranslatorModels": r.TranslatorModels(),
		"OnlineImages":     r.OnlineImages(),
		"CategoryImages":   r.CategoryImages(),
		"CategoryPictures": r.CategoryPictures(),
		"Avatars":          r.Avatars(),
		"Uploads":          r.Uploads(),
		"Incoming":         r.Incoming(),
		"VideoFolders":     r.VideoFolders(),
		"Work":             r.Work(),
		"Categories":       r.Categories(),
		"Database":         r.Database(),

		"OldWhisperModels":    r.OldWhisperModels(),
		"OldTranslatorModels": r.OldTranslatorModels(),
		"OldCategoryImages":   r.OldCategoryImages(),
		"OldCategoryPictures": r.OldCategoryPictures(),
		"OldAvatars":          r.OldAvatars(),
		"OldUploads":          r.OldUploads(),
		"OldIncoming":         r.OldIncoming(),
	}
}

// The folders of a data folder already in use: changing one of these without
// moving the files would lose them.
func TestFoldersKeepTheirNames(t *testing.T) {
	want := map[string]string{
		"Covers":           "covers",
		"OwnCovers":        "own-covers",
		"Previews":         "previews",
		"Clips":            "clips",
		"ClipsHD":          "clips-hd",
		"OwnClips":         "own-clips",
		"Converted":        "converted",
		"Subtitles":        "subtitles",
		"AutoSubtitles":    "autosubtitles",
		"WhisperModels":    filepath.Join("modelli", "whisper"),
		"TranslatorModels": filepath.Join("modelli", "translator"),
		"OnlineImages":     "online",
		"CategoryImages":   filepath.Join("categorie", "immagini"),
		"CategoryPictures": filepath.Join("categorie", "copie"),
		"Avatars":          "utenti",
		"Uploads":          filepath.Join("caricati", "video"),
		"Incoming":         filepath.Join("caricati", "in-arrivo"),
		"VideoFolders":     "video",
		"Work":             "in-corso",
		"Categories":       "categorie",
		"Database":         "database",

		"OldWhisperModels":    "whisper",
		"OldTranslatorModels": "translator",
		"OldCategoryImages":   "category-images",
		"OldCategoryPictures": "category-pictures",
		"OldAvatars":          "avatars",
		"OldUploads":          "uploads",
		"OldIncoming":         "incoming",
	}
	for _, root := range []string{"data", "/contenuti", filepath.Join("a", "b")} {
		got := folders(Root(root))
		if len(got) != len(want) {
			t.Fatalf("%d folders, want %d", len(got), len(want))
		}
		for name, folder := range want {
			if got[name] != filepath.Join(root, folder) {
				t.Errorf("%s of %q = %q, want %q", name, root, got[name], filepath.Join(root, folder))
			}
		}
	}
}

// A new method that says a folder must be added to the table above.
func TestEveryFolderIsInTheTable(t *testing.T) {
	methods := reflect.TypeFor[Root]()
	count := 0
	for i := range methods.NumMethod() {
		kind := methods.Method(i).Type
		// With the Root itself as first argument: it asks nothing, says a path.
		if kind.NumIn() != 1 || kind.NumOut() != 1 || kind.Out(0).Kind() != reflect.String {
			continue
		}
		count++
		if _, ok := folders("x")[methods.Method(i).Name]; !ok {
			t.Errorf("%s is not in the table", methods.Method(i).Name)
		}
	}
	if got := folders("x"); count != len(got) {
		t.Errorf("Root has %d folders, the table %d", count, len(got))
	}
}

// What is not in the new folder may still be in the old one; the new one wins.
func TestFindLooksInTheNewFolderFirst(t *testing.T) {
	newer, older := t.TempDir(), t.TempDir()
	if got := Find(newer, older, "a"); got != filepath.Join(newer, "a") {
		t.Errorf("in no folder: %q", got)
	}
	if err := os.WriteFile(filepath.Join(older, "a"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := Find(newer, older, "a"); got != filepath.Join(older, "a") {
		t.Errorf("in the old folder: %q", got)
	}
	if err := os.WriteFile(filepath.Join(newer, "a"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := Find(newer, older, "a"); got != filepath.Join(newer, "a") {
		t.Errorf("in both: %q", got)
	}
}

func TestEveryFolderIsDifferent(t *testing.T) {
	seen := map[string]string{}
	for name, folder := range folders("x") {
		if other, ok := seen[folder]; ok {
			t.Errorf("%s and %s share %q", name, other, folder)
		}
		seen[folder] = name
	}
}
