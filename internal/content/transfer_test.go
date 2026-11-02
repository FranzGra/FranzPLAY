package content_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/database"
)

// transferFixture is an old instance: flat files, photos, models and an upload.
type transferFixture struct {
	db   *sql.DB
	root content.Root
	out  bytes.Buffer
	free uint64
	id   int64
}

func newTransferFixture(t *testing.T) *transferFixture {
	t.Helper()
	dir := t.TempDir()
	db, err := database.Open(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	fx := &transferFixture{db: db, root: content.Root(dir), free: 1 << 40}
	uploads, err := filepath.Abs(fx.root.OldUploads())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO libraries (id, path) VALUES (1, ?)`, uploads); err != nil {
		t.Fatal(err)
	}
	res, err := db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, added_at, cover, own_cover)
		VALUES (?, 1, 'franz/1-mare.mp4', 5, 1, 'Il mare', 1, 'c1.jpg', 'c2.png')`, fingerprintOld)
	if err != nil {
		t.Fatal(err)
	}
	if fx.id, err = res.LastInsertId(); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO auto_subtitles (video_id, lang, translated_from, model, fingerprint, file, made_at)
		VALUES (?, 'it', '', 'small', ?, 's1.vtt', 1)`, fx.id, fingerprintOld); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO categories (name, image) VALUES ('Mare', 'img.jpg')`); err != nil {
		t.Fatal(err)
	}
	for file, data := range fx.oldFiles() {
		put(t, file, data)
	}
	return fx
}

func (fx *transferFixture) oldFiles() map[string]string {
	r := fx.root
	return map[string]string{
		filepath.Join(r.Covers(), "c1.jpg"):                           "copertina",
		filepath.Join(r.OwnCovers(), "c2.png"):                        "scelta",
		filepath.Join(r.AutoSubtitles(), "s1.vtt"):                    "WEBVTT",
		filepath.Join(r.OldCategoryImages(), "img.jpg"):               "categoria",
		filepath.Join(r.OldAvatars(), "1.jpg"):                        "faccia",
		filepath.Join(r.OldWhisperModels(), "ggml-small.bin"):         "modello",
		filepath.Join(r.OldTranslatorModels(), "en-it", "config.yml"): "models:\n  - \"/old/en-it/model.bin\"\n",
		filepath.Join(r.OldTranslatorModels(), "en-it", "model.bin"):  "pesi",
		filepath.Join(r.OldUploads(), "franz", "1-mare.mp4"):          "video",
	}
}

func jsonOf(t *testing.T, root content.Root, code string) content.Manifest {
	t.Helper()
	data, err := os.ReadFile(root.FileIn(code, content.FileManifest))
	if err != nil {
		t.Fatal(err)
	}
	var m content.Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func put(t *testing.T, file, data string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(file), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte(data), 0o640); err != nil {
		t.Fatal(err)
	}
}

func (fx *transferFixture) transfer() *content.Transfer {
	fx.out.Reset()
	return &content.Transfer{
		DB: fx.db, Root: fx.root, Data: fx.root, Out: &fx.out,
		Free:   func(string) (uint64, error) { return fx.free, nil },
		Backup: database.Backup,
		Now:    func() time.Time { return time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC) },
	}
}

// snapshot gives the hash of every file in a folder.
func snapshot(t *testing.T, dir string) map[string]string {
	t.Helper()
	all := map[string]string{}
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(data)
		all[path] = hex.EncodeToString(sum[:])
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return all
}

func (fx *transferFixture) value(t *testing.T, query string) string {
	t.Helper()
	var v sql.NullString
	if err := fx.db.QueryRow(query).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v.String
}

func (fx *transferFixture) apply(t *testing.T) {
	t.Helper()
	if err := fx.transfer().Apply(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestTransferDryRunChangesNothing(t *testing.T) {
	fx := newTransferFixture(t)
	before := snapshot(t, string(fx.root))
	if err := fx.transfer().DryRun(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(fx.out.String(), "copertine") || !strings.Contains(fx.out.String(), "--apply") {
		t.Errorf("the plan says:\n%s", fx.out.String())
	}
	if fx.value(t, `SELECT cover FROM videos`) != "c1.jpg" {
		t.Error("the row changed")
	}
	after := snapshot(t, string(fx.root))
	delete(before, filepath.Join(string(fx.root), "franzplay.db-wal"))
	delete(after, filepath.Join(string(fx.root), "franzplay.db-wal"))
	delete(before, filepath.Join(string(fx.root), "franzplay.db-shm"))
	delete(after, filepath.Join(string(fx.root), "franzplay.db-shm"))
	for file, sum := range before {
		if after[file] != sum {
			t.Errorf("%s changed", file)
		}
	}
	for file := range after {
		if _, ok := before[file]; !ok {
			t.Errorf("%s appeared", file)
		}
	}
}

func TestTransferWithNoSpaceChangesNothing(t *testing.T) {
	fx := newTransferFixture(t)
	fx.free = 1024
	before := snapshot(t, string(fx.root))
	for name, run := range map[string]func(*content.Transfer) error{
		"dry run": func(tr *content.Transfer) error { return tr.DryRun(context.Background()) },
		"apply":   func(tr *content.Transfer) error { return tr.Apply(context.Background()) },
	} {
		if err := run(fx.transfer()); !errors.Is(err, content.ErrNoSpace) {
			t.Errorf("%s: %v", name, err)
		}
	}
	after := snapshot(t, string(fx.root))
	for file := range after {
		if _, ok := before[file]; !ok && !strings.HasPrefix(filepath.Base(file), "franzplay.db") {
			t.Errorf("%s appeared", file)
		}
	}
	if fx.value(t, `SELECT cover FROM videos`) != "c1.jpg" {
		t.Error("the row changed")
	}
}

func TestTransferCopiesAndKeepsTheOldFiles(t *testing.T) {
	fx := newTransferFixture(t)
	fx.apply(t)

	for file, data := range fx.oldFiles() {
		got, err := os.ReadFile(file)
		if err != nil || string(got) != data {
			t.Errorf("old file %s: %q, %v", file, got, err)
		}
	}
	cover := fx.value(t, `SELECT cover FROM videos`)
	if !content.IsStored(cover) {
		t.Fatalf("cover = %q", cover)
	}
	code, _, _ := strings.Cut(cover, "/")
	for file, data := range map[string]string{
		fx.root.FileIn(code, content.FileCover):                         "copertina",
		fx.root.FileIn(code, content.FileOwnCover+".png"):               "scelta",
		fx.root.FileIn(code, content.AutoSubtitleFile("it")):            "WEBVTT",
		filepath.Join(fx.root.CategoryImages(), "img.jpg"):              "categoria",
		filepath.Join(fx.root.Avatars(), "1.jpg"):                       "faccia",
		filepath.Join(fx.root.WhisperModels(), "ggml-small.bin"):        "modello",
		filepath.Join(fx.root.TranslatorModels(), "en-it", "model.bin"): "pesi",
		filepath.Join(fx.root.Uploads(), "franz", "1-mare.mp4"):         "video",
	} {
		got, err := os.ReadFile(file)
		if err != nil || string(got) != data {
			t.Errorf("copy %s: %q, %v", file, got, err)
		}
	}
	config, err := os.ReadFile(filepath.Join(fx.root.TranslatorModels(), "en-it", "config.yml"))
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.ToSlash(filepath.Join(fx.root.TranslatorModels(), "en-it", "model.bin"))
	if !strings.Contains(string(config), `"`+want+`"`) {
		t.Errorf("the settings of the model say:\n%s", config)
	}
	uploads, err := filepath.Abs(fx.root.Uploads())
	if err != nil {
		t.Fatal(err)
	}
	if got := fx.value(t, `SELECT l.path FROM videos v JOIN libraries l ON l.id = v.library_id`); got != uploads {
		t.Errorf("library = %q, want %q", got, uploads)
	}
	if moved, err := content.UploadsMoved(context.Background(), fx.db); err != nil || !moved {
		t.Errorf("uploads moved = %v, %v", moved, err)
	}
	m := jsonOf(t, fx.root, code)
	if m.Library != uploads {
		t.Errorf("video.json says library %q", m.Library)
	}
	if _, err := os.Stat(filepath.Join(fx.root.Database(), "franzplay_prima-del-trasferimento_01-11-2026.db")); err != nil {
		t.Errorf("no copy of the database before: %v", err)
	}
	// Nothing may clean the old files until they are removed on purpose.
	cleaning, err := content.PlanCleaning(context.Background(), fx.db, fx.root, time.Now(), slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}
	if cleaning.Flat {
		t.Error("the cleaning would take the old files")
	}
}

func TestTransferRunAgainDoesNothingNew(t *testing.T) {
	fx := newTransferFixture(t)
	fx.apply(t)
	before := fx.value(t, `SELECT cover FROM videos`)
	files := snapshot(t, string(fx.root))
	fx.apply(t)
	if fx.value(t, `SELECT cover FROM videos`) != before {
		t.Error("the row changed")
	}
	for file, sum := range files {
		if !strings.HasPrefix(filepath.Base(file), "franzplay.db") && snapshot(t, filepath.Dir(file))[file] != sum {
			t.Errorf("%s changed", file)
		}
	}
	// A copy deleted on purpose after the transfer does not come back.
	photo := filepath.Join(fx.root.Avatars(), "1.jpg")
	if err := os.Remove(photo); err != nil {
		t.Fatal(err)
	}
	fx.apply(t)
	if _, err := os.Stat(photo); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("the photo came back: %v", err)
	}
}

// Stopped before the end: the rows name the old files, which are there; run again,
// it uses what it already copied and ends.
func TestTransferStoppedGoesOnWhenRunAgain(t *testing.T) {
	fx := newTransferFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	tr := fx.transfer()
	copies := 0
	realBackup := tr.Backup
	tr.Backup = func(c context.Context, db *sql.DB, dir, name string) error {
		copies++
		return realBackup(c, db, dir, name)
	}
	cancel()
	if err := tr.Apply(ctx); err == nil {
		t.Fatal("no error when stopped")
	}
	if fx.value(t, `SELECT cover FROM videos`) != "c1.jpg" {
		t.Error("the row changed before the end")
	}
	// A copy left by the first run, as a power cut leaves it.
	put(t, filepath.Join(fx.root.Avatars(), "1.jpg"), "faccia")
	fx.apply(t)
	if !content.IsStored(fx.value(t, `SELECT cover FROM videos`)) {
		t.Error("the second run did not end the work")
	}
	if strings.Contains(fx.out.String(), "Lasciato") {
		t.Errorf("an identical copy counted as a conflict:\n%s", fx.out.String())
	}
}

// Another file where the copy should go: nothing is overwritten, and the old file
// can never be removed.
func TestTransferLeavesAConflictAlone(t *testing.T) {
	fx := newTransferFixture(t)
	photo := filepath.Join(fx.root.Avatars(), "1.jpg")
	put(t, photo, "altra faccia")
	fx.apply(t)
	if got, _ := os.ReadFile(photo); string(got) != "altra faccia" {
		t.Errorf("the other file became %q", got)
	}
	if err := fx.transfer().RemoveOld(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(fx.root.OldAvatars(), "1.jpg")); err != nil {
		t.Errorf("the old file went: %v", err)
	}
}

func TestRemoveOldDeletesOnlyWhatWasCopiedAndChecked(t *testing.T) {
	fx := newTransferFixture(t)
	fx.apply(t)
	code, _, _ := strings.Cut(fx.value(t, `SELECT cover FROM videos`), "/")

	// Never copied, and copied but changed since: both stay.
	stranger := filepath.Join(fx.root.Covers(), "nessuno.jpg")
	put(t, stranger, "di nessuno")
	changedOld := filepath.Join(fx.root.OldWhisperModels(), "ggml-small.bin")
	put(t, changedOld, "modello cambiato")
	// Its copy is gone: the old one stays, it is the only one.
	lostCopy := fx.root.FileIn(code, content.FileOwnCover+".png")
	if err := os.Remove(lostCopy); err != nil {
		t.Fatal(err)
	}

	if err := fx.transfer().RemoveOld(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{stranger, changedOld, filepath.Join(fx.root.OwnCovers(), "c2.png")} {
		if _, err := os.Stat(file); err != nil {
			t.Errorf("%s went: %v", file, err)
		}
	}
	for _, file := range []string{
		filepath.Join(fx.root.Covers(), "c1.jpg"), filepath.Join(fx.root.OldAvatars(), "1.jpg"),
		filepath.Join(fx.root.OldUploads(), "franz", "1-mare.mp4"), filepath.Join(fx.root.OldCategoryImages(), "img.jpg"),
		filepath.Join(fx.root.OldTranslatorModels(), "en-it", "model.bin"),
	} {
		if _, err := os.Stat(file); !errors.Is(err, fs.ErrNotExist) {
			t.Errorf("%s is still there: %v", file, err)
		}
	}
	for _, file := range []string{filepath.Join(fx.root.Uploads(), "franz", "1-mare.mp4"), fx.root.FileIn(code, content.FileCover)} {
		if _, err := os.Stat(file); err != nil {
			t.Errorf("the copy %s went: %v", file, err)
		}
	}
	if got := fx.value(t, `SELECT count(*) FROM settings WHERE key = 'content.hold_flat_files'`); got != "1" {
		t.Error("the hold went with old files still there")
	}
	if !strings.Contains(fx.out.String(), "mai copiati") {
		t.Errorf("not said:\n%s", fx.out.String())
	}

	// Once the person took them away, nothing holds the cleanings any more.
	for _, file := range []string{stranger, changedOld, filepath.Join(fx.root.OwnCovers(), "c2.png")} {
		if err := os.Remove(file); err != nil {
			t.Fatal(err)
		}
	}
	if err := fx.transfer().RemoveOld(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := fx.value(t, `SELECT count(*) FROM settings WHERE key = 'content.hold_flat_files'`); got != "0" {
		t.Error("the hold stayed with nothing to hold")
	}
}

func TestContentFolderDifferentFromTheDataFolder(t *testing.T) {
	fx := newTransferFixture(t)
	tr := fx.transfer()
	other := content.Root(t.TempDir())
	tr.Root = other
	if err := tr.Apply(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got, err := os.ReadFile(filepath.Join(other.Avatars(), "1.jpg")); err != nil || string(got) != "faccia" {
		t.Errorf("copy: %q, %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(fx.root.OldAvatars(), "1.jpg")); err != nil {
		t.Errorf("the old one went: %v", err)
	}
}

func TestCategoriesComeBackFromTheirFile(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	ctx := context.Background()
	put(t, filepath.Join(fx.root.CategoryImages(), "scelta.jpg"), "x")
	put(t, filepath.Join(fx.root.CategoryPictures(), "copia.jpg"), "x")
	fx.exec(t, `INSERT INTO categories (name, label, color, image) VALUES ('Mare', 'Il mare', '#0000ff', 'scelta.jpg'), ('Monti', NULL, NULL, 'sparita.jpg')`)
	fx.exec(t, `INSERT INTO category_pictures (library_id, path, category, size, mod_time, pending, file, width, height)
		VALUES (1, 'Mare/foto.jpg', 'Mare', 3, 4, 0, 'copia.jpg', 10, 20), (1, 'Monti/foto.jpg', 'Monti', 3, 4, 0, 'sparita.jpg', 10, 20)`)
	if err := content.SaveCategories(ctx, fx.db, fx.root); err != nil {
		t.Fatal(err)
	}
	if err := content.RestoreCategories(ctx, fx.db, fx.root, []string{"/videos"}, slog.New(slog.DiscardHandler)); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := fx.db.QueryRow(`SELECT count(*) FROM categories`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("a database that knows them changed: %d, %v", count, err)
	}

	fresh, err := database.Open(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := fresh.Close(); err != nil {
			t.Error(err)
		}
	})
	if err := content.RestoreCategories(ctx, fresh, fx.root, []string{"/videos"}, slog.New(slog.DiscardHandler)); err != nil {
		t.Fatal(err)
	}
	var label, color string
	var image sql.NullString
	if err := fresh.QueryRow(`SELECT label, color, image FROM categories WHERE name = 'Mare'`).Scan(&label, &color, &image); err != nil {
		t.Fatal(err)
	}
	if label != "Il mare" || color != "#0000ff" || image.String != "scelta.jpg" {
		t.Errorf("Mare: %q %q %q", label, color, image.String)
	}
	if err := fresh.QueryRow(`SELECT image FROM categories WHERE name = 'Monti'`).Scan(&image); err != nil || image.Valid {
		t.Errorf("an image gone: %q, %v", image.String, err)
	}
	var pending int
	var file sql.NullString
	if err := fresh.QueryRow(`SELECT pending, file FROM category_pictures WHERE path = 'Mare/foto.jpg'`).Scan(&pending, &file); err != nil {
		t.Fatal(err)
	}
	if pending != 0 || file.String != "copia.jpg" {
		t.Errorf("copy kept: %d %q", pending, file.String)
	}
	if err := fresh.QueryRow(`SELECT pending, file FROM category_pictures WHERE path = 'Monti/foto.jpg'`).Scan(&pending, &file); err != nil {
		t.Fatal(err)
	}
	if pending != 1 || file.Valid {
		t.Errorf("copy gone: %d %q", pending, file.String)
	}
}

func TestVideoJSONSaysWhoSeesTheVideo(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	ctx := context.Background()
	fx.exec(t, `INSERT INTO users (name, password_hash, role, created_at) VALUES ('franz', 'x', 'admin', 1)`)
	fx.exec(t, `UPDATE videos SET hidden_at = 77, private = 1, added_at = 55, uploaded_by = (SELECT id FROM users WHERE name = 'franz') WHERE id = ?`, fx.id)
	if err := content.SaveManifest(ctx, fx.db, fx.root, fx.id); err != nil {
		t.Fatal(err)
	}
	found, err := fx.root.Reuse(ctx, []string{fingerprintOld}, slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}
	u := found[fingerprintOld]
	if u == nil || u.Access == nil {
		t.Fatalf("nothing came back: %+v", u)
	}
	if u.AddedAt != 55 || u.Access.HiddenAt != 77 || !u.Access.Private || u.Access.UploadedBy != "franz" {
		t.Errorf("came back: added %d, %+v", u.AddedAt, *u.Access)
	}
}

func TestSaveAllManifestsGivesOldFoldersTheirAccessOnce(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	ctx := context.Background()
	folder := fx.folder(t)
	if err := content.SaveManifest(ctx, fx.db, fx.root, fx.id); err != nil {
		t.Fatal(err)
	}
	fx.exec(t, `UPDATE videos SET hidden_at = 77 WHERE id = ?`, fx.id)
	if err := content.SaveAllManifests(ctx, fx.db, fx.root, slog.New(slog.DiscardHandler)); err != nil {
		t.Fatal(err)
	}
	if m := jsonOf(t, fx.root, folder); m.Access == nil || m.Access.HiddenAt != 77 {
		t.Errorf("video.json says %+v", m.Access)
	}
}
