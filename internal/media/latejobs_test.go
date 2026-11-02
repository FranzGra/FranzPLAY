package media

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/content"
)

// A job that started on some content and ends after the file changed writes
// nothing and deletes nothing: the folder of that content may be in use, by
// another copy of the same video or by the same file coming back.

// changing returns a run that first changes the content of the video.
func changing(t *testing.T, fx interface{ changeContent(*testing.T) }, run runFunc) runFunc {
	t.Helper()
	return func(ctx context.Context, program string, args ...string) ([]byte, error) {
		fx.changeContent(t)
		return run(ctx, program, args...)
	}
}

func (fx *coverFixture) changeContent(t *testing.T) {
	t.Helper()
	if _, err := fx.db.Exec(`UPDATE videos SET fingerprint = 'v1:other' WHERE id = ?`, fx.id); err != nil {
		t.Error(err)
	}
}

func (fx *clipFixture) changeContent(t *testing.T) {
	t.Helper()
	if _, err := fx.db.Exec(`UPDATE videos SET fingerprint = 'v1:other' WHERE id = ?`, fx.id); err != nil {
		t.Error(err)
	}
}

func (fx *previewFixture) changeContent(t *testing.T) {
	t.Helper()
	if _, err := fx.db.Exec(`UPDATE videos SET fingerprint = 'v1:other' WHERE id = ?`, fx.id); err != nil {
		t.Error(err)
	}
}

func (fx *convertFixture) changeContent(t *testing.T) {
	t.Helper()
	if _, err := fx.db.Exec(`UPDATE videos SET fingerprint = 'v1:other' WHERE id = ?`, fx.id); err != nil {
		t.Error(err)
	}
}

// wantFirst says the file in use is still the first one written.
func wantFirst(t *testing.T, file string) {
	t.Helper()
	got, err := os.ReadFile(file)
	if err != nil {
		t.Errorf("the file in use is gone: %v", err)
		return
	}
	if string(got) != "first" {
		t.Errorf("the file in use was written over: %q", got)
	}
}

func TestALateCoverLeavesTheFileInUseAlone(t *testing.T) {
	fx := newCoverFixture(t, "/videos", "a.mp4")
	fx.c.run = fakeFFmpeg("first", nil)
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	root := content.Root(fx.dataDir)
	file := root.File(fx.cover(t).String, root.Covers())
	fx.c.run = changing(t, fx, fakeFFmpeg("late", nil))
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	wantFirst(t, file)
}

func TestLateClipsLeaveTheFilesInUseAlone(t *testing.T) {
	fx := newClipFixture(t, "/videos", "a.mp4", 60)
	fx.c.run = fakeClipFFmpeg("first", nil)
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	root := content.Root(fx.dataDir)
	clip, clipHD := root.File(fx.saved(t).String, root.Clips()), root.File(fx.savedHD(t).String, root.ClipsHD())
	fx.c.run = changing(t, fx, fakeClipFFmpeg("late", nil))
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	wantFirst(t, clip)
	wantFirst(t, clipHD)
}

func TestLatePreviewsLeaveTheFileInUseAlone(t *testing.T) {
	fx := newPreviewFixture(t, "/videos", "a.mp4", 60)
	fx.p.run = (&fakeFFmpegFrames{length: 60}).run
	if err := fx.p.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	root := content.Root(fx.dataDir)
	file := root.File(fx.saved(t).name.String, root.Previews())
	if err := os.WriteFile(file, []byte("first"), 0o600); err != nil {
		t.Fatal(err)
	}
	fx.p.run = changing(t, fx, (&fakeFFmpegFrames{length: 60}).run)
	if err := fx.p.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	wantFirst(t, file)
}

// The row of another video with the same content still names the copy: its
// stream would answer 404.
func TestALateCopyLeavesTheFileInUseAlone(t *testing.T) {
	fx := newConvertFixture(t, "film.avi", "mpeg4", "mp3")
	fx.c.run = fakeFFmpeg("first", nil)
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	root := content.Root(fx.dataDir)
	file := root.File(fx.converted(t).String, root.Converted())
	if _, err := fx.db.Exec(`UPDATE videos SET converted = NULL WHERE id = ?`, fx.id); err != nil {
		t.Fatal(err)
	}
	fx.c.run = changing(t, fx, fakeFFmpeg("late", nil))
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	wantFirst(t, file)
}

// Tracks is not like the others: it copies only subtitles with no file yet, so
// what it removes when it arrives late is only what it has just made.
func TestLateSubtitleCopiesLeaveTheFilesInUseAlone(t *testing.T) {
	sf := newSubtitleFixture(t, twoSubtitles)
	if err := sf.s.Handle(context.Background(), sf.fx.id); err != nil {
		t.Fatal(err)
	}
	before := sf.files(t)
	if len(before) != 2 {
		t.Fatalf("copies: %q", before)
	}
	ok := sf.s.run
	sf.s.run = func(ctx context.Context, program string, args ...string) ([]byte, error) {
		if _, err := sf.fx.db.Exec(`UPDATE videos SET fingerprint = 'v1:other' WHERE id = ?`, sf.fx.id); err != nil {
			t.Error(err)
		}
		return ok(ctx, program, args...)
	}
	if err := sf.s.Handle(context.Background(), sf.fx.id); err != nil {
		t.Fatal(err)
	}
	if after := sf.files(t); len(after) != len(before) {
		t.Errorf("copies %q, were %q", after, before)
	}
}

// sabotageSubtitles makes writing the subtitles of the video fail, and returns
// how to put things right.
func sabotageSubtitles(t *testing.T, fx *transcribeFixture) (repair func()) {
	t.Helper()
	root := content.Root(fx.dataDir)
	var fingerprint string
	if err := fx.db.QueryRow(`SELECT fingerprint FROM videos WHERE id = ?`, fx.id).Scan(&fingerprint); err != nil {
		t.Fatal(err)
	}
	code, err := content.EnsureVideoFolder(context.Background(), fx.db, root, fx.id, fingerprint)
	if err != nil {
		t.Fatal(err)
	}
	folder := filepath.Dir(root.FileIn(code, content.AutoSubtitleFile("it")))
	if err := os.Rename(folder, folder+".kept"); err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if err := os.WriteFile(folder, []byte("in the way"), 0o600); err != nil {
		t.Fatal(err)
	}
	return func() {
		if err := os.Remove(folder); err != nil {
			t.Fatal(err)
		}
		if err := os.Rename(folder+".kept", folder); err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
	}
}

func (fx *transcribeFixture) savedModels(t *testing.T) []string {
	t.Helper()
	rows, err := fx.db.Query(`SELECT model FROM auto_subtitles WHERE video_id = ? ORDER BY lang`, fx.id)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			t.Error(err)
		}
	}()
	var models []string
	for rows.Next() {
		var m string
		if err := rows.Scan(&m); err != nil {
			t.Fatal(err)
		}
		models = append(models, m)
	}
	return models
}

// Hours of whisper are not lost: a file that could not be written leaves no row
// saying it is there, and the job listens again.
func TestAFailedSubtitleFileLeavesNoRow(t *testing.T) {
	fx := newTranscribeFixture(t)
	fx.ask(t, "", "small", "it")
	repair := sabotageSubtitles(t, fx)
	if err := fx.tr.Handle(context.Background(), fx.id); err == nil {
		t.Fatal("no error")
	}
	if got := fx.savedModels(t); len(got) != 0 {
		t.Errorf("rows %q for a file that is not there", got)
	}
	repair()
	if err := fx.tr.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if len(fx.whisper) != 2 || len(fx.files(t)) != 1 {
		t.Errorf("whisper ran %d times, files %q", len(fx.whisper), fx.files(t))
	}
}

func TestARowWithItsFileGoneIsNotDone(t *testing.T) {
	fx := newTranscribeFixture(t)
	fx.ask(t, "", "small", "it")
	if err := fx.tr.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	root := content.Root(fx.dataDir)
	var saved string
	if err := fx.db.QueryRow(`SELECT file FROM auto_subtitles WHERE video_id = ?`, fx.id).Scan(&saved); err != nil {
		t.Fatal(err)
	}
	file := root.File(saved, root.AutoSubtitles())
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	fx.ask(t, "", "small", "it")
	if err := fx.tr.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(file); err != nil || len(fx.whisper) != 2 {
		t.Errorf("whisper ran %d times, file: %v", len(fx.whisper), err)
	}
}

// With another model, a file that could not be written keeps the old row: it
// goes with the old file.
func TestAFailedFileKeepsTheModelOfTheOldOne(t *testing.T) {
	fx := newTranscribeFixture(t)
	fx.model(t, "base")
	fx.ask(t, "", "small", "it")
	if err := fx.tr.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	fx.ask(t, "", "base", "it")
	repair := sabotageSubtitles(t, fx)
	if err := fx.tr.Handle(context.Background(), fx.id); err == nil {
		t.Fatal("no error")
	}
	if got := fx.savedModels(t); len(got) != 1 || got[0] != "small" {
		t.Errorf("models %q: the file is still the one of small", got)
	}
	repair()
	if err := fx.tr.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if got := fx.savedModels(t); len(got) != 1 || got[0] != "base" {
		t.Errorf("models %q, want base", got)
	}
}
