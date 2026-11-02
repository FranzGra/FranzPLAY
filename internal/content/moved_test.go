package content_test

import (
	"context"
	"database/sql/driver"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"modernc.org/sqlite"

	"github.com/FranzGra/FranzPLAY/internal/content"
)

func init() {
	sqlite.MustRegisterScalarFunction("file_is_there", 1, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		file, _ := args[0].(string)
		if _, err := os.Stat(file); err != nil {
			return int64(0), nil //nolint:nilerr // a file not there is the answer, not a failure
		}
		return int64(1), nil
	})
}

// A folder renamed between --apply and --remove-old is still the same folder.
func TestRemoveOldFollowsARenamedFolder(t *testing.T) {
	fx := newTransferFixture(t)
	fx.apply(t)
	var fingerprint string
	if err := fx.db.QueryRow(`SELECT fingerprint FROM videos`).Scan(&fingerprint); err != nil {
		t.Fatal(err)
	}
	renamed, err := fx.root.FollowName(fingerprint, "un altro nome.mp4")
	if err != nil || !renamed {
		t.Fatalf("renamed %v, %v", renamed, err)
	}
	if err := fx.transfer().RemoveOld(context.Background()); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(fx.out.String(), "non c'è più") {
		t.Errorf("a copy in a renamed folder looks lost:\n%s", fx.out.String())
	}
	if _, err := os.Stat(filepath.Join(fx.root.Covers(), "c1.jpg")); !os.IsNotExist(err) {
		t.Errorf("the old file stays for ever: %v", err)
	}
}

// A stop between moving a chosen file and saving where it went must find it where
// the row says: the file is taken from its old place only after the row changed.
func TestAChoiceLeavesItsPlaceAfterTheRowChanged(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	oldCode := fx.folder(t)
	file := content.FileOwnCover + ".png"
	if err := fx.root.PutBytes(oldCode, file, []byte("scelta")); err != nil {
		t.Fatal(err)
	}
	fx.exec(t, `UPDATE videos SET fingerprint = ?, own_cover = ? WHERE id = ?`,
		fingerprintNew, content.Stored(oldCode, file, "abc"), fx.id)
	fx.exec(t, `CREATE TRIGGER seen BEFORE UPDATE OF own_cover ON videos BEGIN
		INSERT INTO settings (key, value) VALUES ('old file there', file_is_there('`+fx.root.FileIn(oldCode, file)+`')); END`)
	fx.afterScan(t, nil, []int64{fx.id})

	var there string
	if err := fx.db.QueryRow(`SELECT value FROM settings WHERE key = 'old file there'`).Scan(&there); err != nil {
		t.Fatal(err)
	}
	if there != "1" {
		t.Error("the file left its place before the row changed: a stop there loses the choice")
	}
	code, ok, err := fx.root.FolderOf(fingerprintNew)
	if err != nil || !ok {
		t.Fatalf("new folder %q, %v, %v", code, ok, err)
	}
	if data, err := os.ReadFile(fx.root.FileIn(code, file)); err != nil || string(data) != "scelta" {
		t.Errorf("the choice: %q, %v", data, err)
	}
	if _, err := os.Stat(fx.root.FileIn(oldCode, file)); !os.IsNotExist(err) {
		t.Errorf("still in the old folder: %v", err)
	}
}

// Whatever the file says, a video.json being saved and a folder being renamed do
// not get in the way of each other.
func TestSavingVideoJSONWhileTheFolderIsRenamed(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	fx.folder(t)
	stop, done := make(chan struct{}), make(chan error, 1)
	go func() {
		for i := 0; ; i++ {
			select {
			case <-stop:
				done <- nil
				return
			default:
			}
			name := "mare.mp4"
			if i%2 == 0 {
				name = "monti.mp4"
			}
			if _, err := fx.root.FollowName(fingerprintOld, name); err != nil {
				done <- err
				return
			}
		}
	}()
	for i := range 300 {
		fx.exec(t, `UPDATE videos SET hidden_at = ? WHERE id = ?`, i+1, fx.id)
		if err := content.SaveManifest(context.Background(), fx.db, fx.root, fx.id); err != nil {
			t.Errorf("save while renaming: %v", err)
			break
		}
	}
	close(stop)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

// categorie.json is read like video.json: nothing it says goes out of the library
// to ffmpeg, and what is wrong is left out.
func TestCategoriesFileCannotPointOutside(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	put(t, filepath.Join(fx.root.Categories(), content.FileCategories), `{"version": 1,
		"categories": [{"name": "Mare", "color": "rosso"}, {"name": ""}],
		"pictures": [
			{"library": "/videos", "path": "../../etc/passwd", "category": "Mare", "size": 1, "modTime": 1},
			{"library": "/videos", "path": "/etc/passwd", "category": "Mare", "size": 1, "modTime": 1},
			{"library": "/videos", "path": "Mare/foto.jpg", "category": "Mare", "size": 1, "modTime": 1}]}`)
	if err := content.RestoreCategories(context.Background(), fx.db, fx.root, []string{"/videos"}, slog.New(slog.DiscardHandler)); err != nil {
		t.Fatal(err)
	}
	rows := 0
	if err := fx.db.QueryRow(`SELECT count(*) FROM category_pictures WHERE path IN ('../../etc/passwd', '/etc/passwd')`).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Errorf("%d pictures out of the library", rows)
	}
	var color *string
	if err := fx.db.QueryRow(`SELECT color FROM categories WHERE name = 'Mare'`).Scan(&color); err != nil || color != nil {
		t.Errorf("a color that is not a color: %v, %v", color, err)
	}
	if err := fx.db.QueryRow(`SELECT count(*) FROM categories WHERE name = ''`).Scan(&rows); err != nil || rows != 0 {
		t.Errorf("a category with no name: %d, %v", rows, err)
	}
	if err := fx.db.QueryRow(`SELECT count(*) FROM category_pictures WHERE path = 'Mare/foto.jpg'`).Scan(&rows); err != nil || rows != 1 {
		t.Errorf("the good picture: %d, %v", rows, err)
	}
}

// A file that cannot be understood may hold the only list of what was chosen.
func TestAnUnreadableCategoriesFileIsNotWrittenOver(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	file := filepath.Join(fx.root.Categories(), content.FileCategories)
	for _, data := range []string{"{rotto", `{"version": 99, "categories": []}`} {
		put(t, file, data)
		fx.exec(t, `INSERT INTO categories (name) VALUES ('Mare') ON CONFLICT (name) DO NOTHING`)
		_ = content.SaveCategories(context.Background(), fx.db, fx.root)
		got, err := os.ReadFile(file)
		if err != nil || string(got) != data {
			t.Errorf("file = %q, %v; want %q", got, err, data)
		}
	}
}
