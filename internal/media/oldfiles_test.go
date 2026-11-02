package media

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/content"
)

// An instance from before the folders of the videos has its files and its rows
// in the old form. Nothing here may lose them or make them again for nothing.

func writeOld(t *testing.T, dir, name, data string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, name)
	if err := os.WriteFile(file, []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}
	return file
}

func TestAnOldCopyOfAFilmIsNotMadeAgain(t *testing.T) {
	fx := newConvertFixture(t, "film.mkv", "hevc", "ac3")
	root := content.Root(fx.dataDir)
	var fingerprint string
	if err := fx.db.QueryRow(`SELECT fingerprint FROM videos WHERE id = ?`, fx.id).Scan(&fingerprint); err != nil {
		t.Fatal(err)
	}
	name := convertedName(fx.id, fingerprint)
	old := writeOld(t, root.Converted(), name, "hours of work")
	if _, err := fx.db.Exec(`UPDATE videos SET converted = ? WHERE id = ?`, name, fx.id); err != nil {
		t.Fatal(err)
	}
	fx.c.run = func(context.Context, string, ...string) ([]byte, error) {
		t.Error("ffmpeg ran for a copy that is already there")
		return nil, nil
	}
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if got := fx.converted(t); got.String != name {
		t.Errorf("converted = %+v, want still %q", got, name)
	}
	if data, err := os.ReadFile(old); err != nil || string(data) != "hours of work" {
		t.Errorf("old copy = %q, %v", data, err)
	}
	if _, err := RemoveOrphanConverted(context.Background(), fx.db, root); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(old); err != nil {
		t.Errorf("the cleaning at start took the old copy: %v", err)
	}
}

func TestOldCopiesOfSubtitlesAreKept(t *testing.T) {
	sf := newSubtitleFixture(t, twoSubtitles)
	root := content.Root(sf.fx.dataDir)
	old := subtitleName(sf.fx.id, "fp", 2)
	file := writeOld(t, root.Subtitles(), old, "WEBVTT old")
	if err := sf.s.Handle(context.Background(), sf.fx.id); err != nil {
		t.Fatal(err)
	}
	got := sf.saved(t)
	if len(got) != 2 || got[0].file != old || content.FileOf(got[1].file) != content.InsideSubtitleFile(4) {
		t.Fatalf("saved %+v, want the old copy and a new one", got)
	}
	if data, err := os.ReadFile(file); err != nil || string(data) != "WEBVTT old" {
		t.Errorf("old copy = %q, %v", data, err)
	}
	if _, err := RemoveOrphanSubtitles(context.Background(), sf.fx.db, root); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(file); err != nil {
		t.Errorf("the cleaning at start took the old copy: %v", err)
	}
	// The next reading finds both in their places.
	before := sf.ffmpegs
	if err := sf.s.Handle(context.Background(), sf.fx.id); err != nil {
		t.Fatal(err)
	}
	if sf.ffmpegs != before {
		t.Errorf("ffmpeg ran again: %d times, was %d", sf.ffmpegs, before)
	}
}

// The cleanings at start leave alone the old files still named by the database
// and every folder of a video.
func TestTheCleaningsAtStartKeepOldAndNew(t *testing.T) {
	ctx := context.Background()
	db, id := catalog(t, "/videos", "a.mp4")
	root := content.Root(t.TempDir())
	code, err := content.EnsureVideoFolder(ctx, db, root, id, "fp")
	if err != nil {
		t.Fatal(err)
	}
	var keep []string
	type kind struct {
		dir, column string
		clean       func(context.Context, *sql.DB, content.Root) (int, error)
	}
	for _, k := range []kind{
		{root.Covers(), "cover", RemoveOrphanCovers},
		{root.OwnCovers(), "own_cover", RemoveOrphanOwnCovers},
		{root.Previews(), "preview", RemoveOrphanPreviews},
		{root.Converted(), "converted", RemoveOrphanConverted},
		{root.OwnClips(), "own_clip", RemoveOrphanOwnClips},
	} {
		keep = append(keep, writeOld(t, k.dir, "1-old.bin", "old"))
		gone := writeOld(t, k.dir, "99-forgotten.bin", "x")
		if _, err := db.Exec(`UPDATE videos SET `+k.column+` = '1-old.bin' WHERE id = ?`, id); err != nil {
			t.Fatal(err)
		}
		if n, err := k.clean(ctx, db, root); err != nil || n != 1 {
			t.Errorf("%s: removed %d, %v; want the forgotten file", k.column, n, err)
		}
		if _, err := os.Stat(gone); err == nil {
			t.Errorf("%s: forgotten file still there", k.column)
		}
	}
	for _, file := range []string{content.FileCover, content.FileTimeline, content.FileClip, content.FileClipHD,
		content.FileConverted, content.AutoSubtitleFile("it"), content.InsideSubtitleFile(2)} {
		if err := root.PutBytes(code, file, []byte("new")); err != nil {
			t.Fatal(err)
		}
		keep = append(keep, root.FileIn(code, file))
	}
	for _, clean := range []func(context.Context, *sql.DB, content.Root) (int, error){
		RemoveOrphanCovers, RemoveOrphanOwnCovers, RemoveOrphanPreviews, RemoveOrphanConverted,
		RemoveOrphanOwnClips, RemoveOrphanClips, RemoveOrphanSubtitles, RemoveOrphanAutoSubtitles,
	} {
		if _, err := clean(ctx, db, root); err != nil {
			t.Error(err)
		}
	}
	for _, file := range keep {
		if _, err := os.Stat(file); err != nil {
			t.Errorf("%s went: %v", file, err)
		}
	}
}
