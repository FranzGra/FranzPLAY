package autosubs

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/media"
)

// The models of an installation not moved yet are in the old folder: the page
// says that one, and a new model goes there too, not in a second place.
func TestModelsStayInTheOldFolderUntilItMoves(t *testing.T) {
	s := newSite(t)
	root := content.Root(t.TempDir())
	s.opts.Content = root
	if err := os.MkdirAll(root.OldWhisperModels(), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root.OldWhisperModels(), "ggml-small.bin"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	got := decode[Setup](t, s.do(t, "GET", "/api/admin/subtitles/setup", "", http.StatusOK))
	if want, _ := filepath.Abs(root.OldWhisperModels()); got.ModelsFolder != want {
		t.Errorf("folder shown %q, want %q", got.ModelsFolder, want)
	}
	if dir := filepath.Dir(media.NewModelFile(root, "base")); dir != root.OldWhisperModels() {
		t.Errorf("a new model goes to %q", dir)
	}

	// Once a model is in the new folder, that is the one.
	if err := os.MkdirAll(root.WhisperModels(), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root.WhisperModels(), "ggml-medium.bin"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if dir := filepath.Dir(media.NewModelFile(root, "base")); dir != root.WhisperModels() {
		t.Errorf("a new model goes to %q", dir)
	}
}
