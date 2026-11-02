package content_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/database"
)

const (
	fingerprintOld = "v1:000000000000000000000000a1b2c3d4"
	fingerprintNew = "v1:0000000000000000000000000f0f0f0f"
)

type manifestFixture struct {
	db   *sql.DB
	root content.Root
	id   int64
	logs *bytes.Buffer
}

func newManifestFixture(t *testing.T, rel string) *manifestFixture {
	t.Helper()
	db, err := database.Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	if _, err := db.Exec(`INSERT INTO libraries (id, path) VALUES (1, '/videos')`); err != nil {
		t.Fatal(err)
	}
	res, err := db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, added_at)
		VALUES (?, 1, ?, 1, 1, 'Il mare', 1)`, fingerprintOld, rel)
	if err != nil {
		t.Fatal(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return &manifestFixture{db: db, root: content.Root(t.TempDir()), id: id, logs: &bytes.Buffer{}}
}

func (fx *manifestFixture) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := fx.db.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

func (fx *manifestFixture) folder(t *testing.T) string {
	t.Helper()
	code, err := content.EnsureVideoFolder(context.Background(), fx.db, fx.root, fx.id, fingerprintOld)
	if err != nil {
		t.Fatal(err)
	}
	return code
}

func (fx *manifestFixture) afterScan(t *testing.T, moved, replaced []int64) {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(fx.logs, nil))
	content.AfterScan(context.Background(), fx.db, fx.root, moved, replaced, logger)
}

// names lists the folders of the videos.
func (fx *manifestFixture) names(t *testing.T) []string {
	t.Helper()
	entries, err := os.ReadDir(fx.root.VideoFolders())
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

func readJSON(t *testing.T, root content.Root, folder string) content.Manifest {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root.VideoFolders(), folder, content.FileManifest))
	if err != nil {
		t.Fatal(err)
	}
	var m content.Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestManifestSaysWhatThereIs(t *testing.T) {
	fx := newManifestFixture(t, "Viaggi/mare.mp4")
	code := fx.folder(t)
	if got := readJSON(t, fx.root, "mare ["+code+"]"); got.Path != "Viaggi/mare.mp4" || got.Library != "/videos" ||
		got.Fingerprint != fingerprintOld || got.Version != content.ManifestVersion || got.Title == "" {
		t.Errorf("first video.json = %+v", got)
	}

	inside := content.Stored(code, content.InsideSubtitleFile(2), "")
	auto := content.Stored(code, content.AutoSubtitleFile("it"), "")
	translated := content.Stored(code, content.AutoSubtitleFile("en"), "")
	fx.exec(t, `UPDATE videos SET own_cover = ?, cover_second = 30, own_clip = ?, admin_title = 'Scelto', admin_category = '',
		preview = ?, preview_gap = 3, preview_count = 84, preview_width = 480, preview_height = 270 WHERE id = ?`,
		content.Stored(code, content.FileOwnCover+".png", "abc"), content.Stored(code, content.FileOwnClip+".mp4", "def"),
		content.Stored(code, content.FileTimeline, "w480t"), fx.id)
	fx.exec(t, `INSERT INTO video_subtitles (video_id, stream, lang, title, forced, file) VALUES
		(?, 2, 'eng', 'Forced', 1, ?), (?, 3, 'fra', '', 0, '1-old-3.vtt')`, fx.id, inside, fx.id)
	fx.exec(t, `INSERT INTO auto_subtitles (video_id, lang, translated_from, model, fingerprint, file, made_at) VALUES
		(?, 'it', '', 'small', ?, ?, 7), (?, 'en', 'it', 'small', ?, ?, 8), (?, 'de', '', 'small', 'old content', 'x.vtt', 1)`,
		fx.id, fingerprintOld, auto, fx.id, fingerprintOld, translated, fx.id)
	if err := content.SaveManifest(context.Background(), fx.db, fx.root, fx.id); err != nil {
		t.Fatal(err)
	}

	m := readJSON(t, fx.root, "mare ["+code+"]")
	if m.Choices.CoverFile != "copertina-scelta.png" || m.Choices.ClipFile != "anteprima-scelta.mp4" ||
		m.Choices.CoverSecond == nil || *m.Choices.CoverSecond != 30 ||
		m.Choices.Title == nil || *m.Choices.Title != "Scelto" || m.Choices.Category == nil || *m.Choices.Category != "" {
		t.Errorf("choices = %+v", m.Choices)
	}
	if m.Timeline == nil || m.Timeline.File != content.FileTimeline || m.Timeline.Gap != 3 || m.Timeline.Count != 84 {
		t.Errorf("timeline = %+v", m.Timeline)
	}
	found := map[string]content.Subtitle{}
	for _, s := range m.Subtitles {
		found[s.File] = s
	}
	if len(found) != 3 {
		t.Fatalf("subtitles = %+v, want those in the folder only", m.Subtitles)
	}
	if s := found["sottotitoli/traccia-2.vtt"]; s.Lang != "eng" || s.Stream == nil || *s.Stream != 2 || !s.Forced {
		t.Errorf("inside = %+v", s)
	}
	if s := found["sottotitoli/automatici-it.vtt"]; s.Lang != "it" || s.Model != "small" || s.TranslatedFrom != "" || s.Stream != nil {
		t.Errorf("made = %+v", s)
	}
	if s := found["sottotitoli/automatici-en.vtt"]; s.Lang != "en" || s.TranslatedFrom != "it" {
		t.Errorf("translated = %+v", s)
	}
	// Written whole: nothing else is left beside it.
	entries, err := os.ReadDir(filepath.Join(fx.root.VideoFolders(), "mare ["+code+"]"))
	if err != nil || len(entries) != 1 {
		t.Errorf("folder holds %v, %v", entries, err)
	}
}

func TestSaveManifestWithNoFolderWritesNothing(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	if err := content.SaveManifest(context.Background(), fx.db, fx.root, fx.id); err != nil {
		t.Fatal(err)
	}
	if err := content.SaveManifest(context.Background(), fx.db, fx.root, 999); err != nil {
		t.Errorf("a video not there: %v", err)
	}
	if names := fx.names(t); len(names) != 0 {
		t.Errorf("folders = %q", names)
	}
}

func TestAfterScanTheFolderFollowsTheFile(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	code := fx.folder(t)

	// A move to another folder of the library: only video.json changes.
	fx.exec(t, `UPDATE videos SET path = 'Viaggi/mare.mp4' WHERE id = ?`, fx.id)
	fx.afterScan(t, []int64{fx.id}, nil)
	if names := fx.names(t); len(names) != 1 || names[0] != "mare ["+code+"]" {
		t.Fatalf("after the move: %q", names)
	}
	if m := readJSON(t, fx.root, "mare ["+code+"]"); m.Path != "Viaggi/mare.mp4" {
		t.Errorf("after the move, path = %q", m.Path)
	}

	// A new name: the folder takes it, and its files are found.
	if err := fx.root.PutBytes(code, content.FileCover, []byte("jpeg")); err != nil {
		t.Fatal(err)
	}
	fx.exec(t, `UPDATE videos SET path = 'Viaggi/Il mare.mp4' WHERE id = ?`, fx.id)
	fx.afterScan(t, []int64{fx.id}, nil)
	if names := fx.names(t); len(names) != 1 || names[0] != "Il mare ["+code+"]" {
		t.Fatalf("after the rename: %q", names)
	}
	if m := readJSON(t, fx.root, "Il mare ["+code+"]"); m.Path != "Viaggi/Il mare.mp4" {
		t.Errorf("after the rename, path = %q", m.Path)
	}
	if data, err := os.ReadFile(fx.root.File(content.Stored(code, content.FileCover, ""), "")); err != nil || string(data) != "jpeg" {
		t.Errorf("cover = %q, %v", data, err)
	}
}

// A rename that fails is only told, and the next scan tries again.
func TestARenameThatFailsIsTriedAgain(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	code := fx.folder(t)
	if err := fx.root.PutBytes(code, content.FileCover, []byte("jpeg")); err != nil {
		t.Fatal(err)
	}
	// A folder full of something is where the new name would go.
	blocker := filepath.Join(fx.root.VideoFolders(), "lago ["+code+"]")
	if err := os.MkdirAll(filepath.Join(blocker, "pieno"), 0o750); err != nil {
		t.Fatal(err)
	}
	fx.exec(t, `UPDATE videos SET path = 'lago.mp4' WHERE id = ?`, fx.id)
	fx.afterScan(t, []int64{fx.id}, nil)
	if !strings.Contains(fx.logs.String(), "tried again") {
		t.Errorf("log = %q", fx.logs)
	}
	if data, err := os.ReadFile(fx.root.File(content.Stored(code, content.FileCover, ""), "")); err != nil || string(data) != "jpeg" {
		t.Errorf("cover while the name is old = %q, %v", data, err)
	}

	if err := os.RemoveAll(blocker); err != nil {
		t.Fatal(err)
	}
	// The next scan has nothing to say about this video: it looks all the same.
	fx.afterScan(t, nil, nil)
	if names := fx.names(t); len(names) != 1 || names[0] != "lago ["+code+"]" {
		t.Errorf("after the next scan: %q", names)
	}
}

func TestAfterScanANewFileGetsANewFolder(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	oldCode := fx.folder(t)
	for _, file := range []string{content.FileCover, content.FileOwnCover + ".png", content.FileOwnClip + ".mp4"} {
		if err := fx.root.PutBytes(oldCode, file, []byte(file)); err != nil {
			t.Fatal(err)
		}
	}
	cover := content.Stored(oldCode, content.FileCover, "")
	fx.exec(t, `UPDATE videos SET fingerprint = ?, cover = ?, own_cover = ?, own_clip = ? WHERE id = ?`,
		fingerprintNew, cover, content.Stored(oldCode, content.FileOwnCover+".png", "abc"),
		content.Stored(oldCode, content.FileOwnClip+".mp4", "def"), fx.id)
	fx.afterScan(t, nil, []int64{fx.id})

	code, ok, err := fx.root.FolderOf(fingerprintNew)
	if err != nil || !ok || code == oldCode {
		t.Fatalf("new folder %q, %v, %v", code, ok, err)
	}
	if names := fx.names(t); len(names) != 2 {
		t.Fatalf("folders = %q, want the old one still there", names)
	}
	// What the pages show until the jobs make it again stays in the old folder.
	if data, err := os.ReadFile(fx.root.File(cover, "")); err != nil || string(data) != content.FileCover {
		t.Errorf("old cover = %q, %v", data, err)
	}
	// What the administrator chose moves on, with its version.
	var ownCover, ownClip string
	if err := fx.db.QueryRow(`SELECT own_cover, own_clip FROM videos WHERE id = ?`, fx.id).Scan(&ownCover, &ownClip); err != nil {
		t.Fatal(err)
	}
	if ownCover != content.Stored(code, content.FileOwnCover+".png", "abc") || ownClip != content.Stored(code, content.FileOwnClip+".mp4", "def") {
		t.Errorf("chosen = %q and %q", ownCover, ownClip)
	}
	for _, value := range []string{ownCover, ownClip} {
		if _, err := os.Stat(fx.root.File(value, "")); err != nil {
			t.Errorf("%s: %v", value, err)
		}
	}
	if _, err := os.Stat(fx.root.FileIn(oldCode, content.FileOwnCover+".png")); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("chosen file still in the old folder: %v", err)
	}
	m := readJSON(t, fx.root, "mare ["+code+"]")
	if m.Fingerprint != fingerprintNew || m.Choices.CoverFile != content.FileOwnCover+".png" {
		t.Errorf("video.json = %+v", m)
	}
}

// A choice in the old flat folders stays there, and is not lost.
func TestAfterScanAnOldChoiceStaysWhereItIs(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	fx.exec(t, `UPDATE videos SET fingerprint = ?, own_cover = '1-0123456789abcdef.png' WHERE id = ?`, fingerprintNew, fx.id)
	fx.afterScan(t, nil, []int64{fx.id})
	var own string
	if err := fx.db.QueryRow(`SELECT own_cover FROM videos WHERE id = ?`, fx.id).Scan(&own); err != nil || own != "1-0123456789abcdef.png" {
		t.Errorf("own cover = %q, %v", own, err)
	}
}
