package content_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/content"
)

// fullFolder makes the folder of the fixture's video as a finished video leaves
// it: everything done, every file there, a video.json saying so.
func (fx *manifestFixture) fullFolder(t *testing.T) string {
	t.Helper()
	code := fx.folder(t)
	for _, file := range []string{content.FileCover, content.FileTimeline, content.FileClip, content.FileClipHD,
		content.FileConverted, content.FileOnlineImage, content.FileOwnCover + ".png", content.FileOwnClip + ".mp4",
		content.InsideSubtitleFile(2), content.AutoSubtitleFile("it")} {
		if err := fx.root.PutBytes(code, file, []byte("made")); err != nil {
			t.Fatal(err)
		}
	}
	stored := func(file, version string) string { return content.Stored(code, file, version) }
	fx.exec(t, `UPDATE videos SET duration = 2880, width = 1920, height = 1080, video_codec = 'hevc', audio_codec = 'ac3',
			container = 'matroska', pixel_format = 'yuv420p', cover = ?, preview = ?, preview_gap = 10, preview_count = 288,
			preview_width = 320, preview_height = 180, clip = ?, clip_hd = ?, converted = ?, own_cover = ?, own_clip = ?,
			cover_second = 42, no_clip = 0, admin_title = 'Il mio mare', admin_category = 'Viaggi', cover_image = 'v1',
			online_title = 'Mare', online_cover = ? WHERE id = ?`,
		stored(content.FileCover, "s1"), stored(content.FileTimeline, "s2"), stored(content.FileClip, "s3"),
		stored(content.FileClipHD, "s3"), stored(content.FileConverted, ""), stored(content.FileOwnCover+".png", "own1"),
		stored(content.FileOwnClip+".mp4", "own2"), stored(content.FileOnlineImage, "s4"), fx.id)
	fx.exec(t, `INSERT INTO video_subtitles (video_id, stream, lang, title, forced, file) VALUES (?, 2, 'en', 'Inglese', 0, ?)`,
		fx.id, stored(content.InsideSubtitleFile(2), ""))
	fx.exec(t, `INSERT INTO auto_subtitles (video_id, lang, translated_from, model, fingerprint, file, made_at)
		VALUES (?, 'it', '', 'base', ?, ?, 77)`, fx.id, fingerprintOld, stored(content.AutoSubtitleFile("it"), ""))
	fx.exec(t, `INSERT INTO video_audio (video_id, stream, lang, title, codec, channels, is_default)
		VALUES (?, 1, 'it', '', 'ac3', 6, 1)`, fx.id)
	for _, kind := range []string{"probe", "details", "online", "cover", "preview", "clip", "tracks", "convert"} {
		fx.exec(t, `INSERT INTO jobs (video_id, kind, state, updated_at) VALUES (?, ?, 'done', 1)`, fx.id, kind)
	}
	if err := content.SaveManifest(context.Background(), fx.db, fx.root, fx.id); err != nil {
		t.Fatal(err)
	}
	return code
}

func (fx *manifestFixture) reuse(t *testing.T) *content.Reused {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(fx.logs, nil))
	found, err := fx.root.Reuse(context.Background(), []string{fingerprintOld}, logger)
	if err != nil {
		t.Fatal(err)
	}
	return found[fingerprintOld]
}

// changeJSON changes the video.json of a folder by hand, as a bad copy might.
func (fx *manifestFixture) changeJSON(t *testing.T, code string, change func(m *content.Manifest)) {
	t.Helper()
	file := fx.root.FileIn(code, content.FileManifest)
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var m content.Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}
	change(&m)
	if data, err = json.Marshal(m); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestReuseGivesBackAllThereIs(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	code := fx.fullFolder(t)
	u := fx.reuse(t)
	if u == nil {
		t.Fatal("nothing reused")
	}
	for _, kind := range []string{"probe", "online", "cover", "preview", "clip", "tracks", "convert"} {
		if !u.Finished(kind) {
			t.Errorf("job %s not finished", kind)
		}
	}
	if u.Finished("details") {
		t.Error("the file next to the video must be read again")
	}
	if u.Info == nil || u.Info.Duration != 2880 || u.Info.VideoCodec != "hevc" {
		t.Errorf("info = %+v", u.Info)
	}
	if u.Cover != content.Stored(code, content.FileCover, "s1") || u.Preview != content.Stored(code, content.FileTimeline, "s2") ||
		u.PreviewGap != 10 || u.PreviewCount != 288 || u.PreviewWidth != 320 || u.PreviewHeight != 180 {
		t.Errorf("reused = %+v", u)
	}
	if u.OwnCover != content.Stored(code, content.FileOwnCover+".png", "own1") ||
		u.OwnClip != content.Stored(code, content.FileOwnClip+".mp4", "own2") ||
		u.CoverSecond == nil || *u.CoverSecond != 42 ||
		u.AdminTitle == nil || *u.AdminTitle != "Il mio mare" || u.AdminCategory == nil || *u.AdminCategory != "Viaggi" ||
		u.CoverImage == nil || *u.CoverImage != "v1" {
		t.Errorf("choices = %+v", u)
	}
	if len(u.Inside) != 1 || u.Inside[0].Lang != "en" || *u.Inside[0].Stream != 2 ||
		u.Inside[0].File != content.Stored(code, content.InsideSubtitleFile(2), "") {
		t.Errorf("subtitles of the file = %+v", u.Inside)
	}
	if len(u.Auto) != 1 || u.Auto[0].Model != "base" || u.Auto[0].MadeAt != 77 ||
		u.Auto[0].File != content.Stored(code, content.AutoSubtitleFile("it"), "") {
		t.Errorf("automatic subtitles = %+v", u.Auto)
	}
	if len(u.Audio) != 1 || u.Audio[0].Channels != 6 || !u.Audio[0].Default {
		t.Errorf("audio = %+v", u.Audio)
	}
	if len(u.Skipped) != 0 {
		t.Errorf("skipped = %q", u.Skipped)
	}
}

// No name from a video.json leaves the folder: a file outside it is never given
// to the database, even if it exists.
func TestReuseKeepsNamesInsideTheFolder(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	code := fx.fullFolder(t)
	secret := filepath.Join(fx.root.VideoFolders(), "segreto.jpg")
	if err := os.WriteFile(secret, []byte("not yours"), 0o600); err != nil {
		t.Fatal(err)
	}
	outside := "../segreto.jpg"
	fx.changeJSON(t, code, func(m *content.Manifest) {
		m.Cover = &content.File{File: outside}
		m.Timeline.File = outside
		m.Clip = &content.File{File: outside}
		m.ClipHD = &content.File{File: "/etc/passwd"}
		m.Converted = &content.File{File: "sottotitoli/../" + outside}
		m.Online.Image = &content.File{File: outside}
		m.Choices.CoverFile = content.FileOwnCover + "./../segreto.jpg"
		m.Choices.ClipFile = outside
		for i := range m.Subtitles {
			m.Subtitles[i].File = outside
		}
	})
	u := fx.reuse(t)
	if u == nil {
		t.Fatal("the folder itself is fine")
	}
	for name, value := range map[string]string{"cover": u.Cover, "preview": u.Preview, "clip": u.Clip, "clip hd": u.ClipHD,
		"converted": u.Converted, "online": u.OnlineImage, "own cover": u.OwnCover, "own clip": u.OwnClip} {
		if value != "" {
			t.Errorf("%s = %q", name, value)
		}
	}
	if len(u.Inside)+len(u.Auto) != 0 {
		t.Errorf("subtitles = %+v %+v", u.Inside, u.Auto)
	}
	for _, kind := range []string{"cover", "preview", "clip", "tracks", "convert", "online"} {
		if u.Finished(kind) {
			t.Errorf("job %s finished with a name outside", kind)
		}
	}
	if !u.Finished("probe") {
		t.Error("what ffprobe read has no file: it stays")
	}
}

// A link inside the folder that points outside is not a file of the folder.
func TestReuseDoesNotFollowLinks(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	code := fx.fullFolder(t)
	outside := filepath.Join(t.TempDir(), "fuori.jpg")
	if err := os.WriteFile(outside, []byte("not yours"), 0o600); err != nil {
		t.Fatal(err)
	}
	cover := fx.root.FileIn(code, content.FileCover)
	if err := os.Remove(cover); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, cover); err != nil {
		t.Skip("no links here:", err)
	}
	// The whole subtitles folder goes outside too.
	subs := filepath.Dir(fx.root.FileIn(code, content.InsideSubtitleFile(2)))
	if err := os.RemoveAll(subs); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(t.TempDir(), subs); err != nil {
		t.Fatal(err)
	}
	u := fx.reuse(t)
	if u == nil || u.Cover != "" || u.Finished("cover") || len(u.Inside)+len(u.Auto) != 0 || u.Finished("tracks") {
		t.Errorf("reused = %+v", u)
	}
}

// What is missing or empty is made again by its job, and only that.
func TestReuseOfAFileMissingOrEmpty(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	code := fx.fullFolder(t)
	if err := os.Remove(fx.root.FileIn(code, content.FileClip)); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fx.root.FileIn(code, content.FileCover), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(fx.root.FileIn(code, content.InsideSubtitleFile(2))); err != nil {
		t.Fatal(err)
	}
	u := fx.reuse(t)
	if u == nil {
		t.Fatal("nothing reused")
	}
	if u.Cover != "" || u.Clip != "" || len(u.Inside) != 0 {
		t.Errorf("reused = %+v", u)
	}
	for kind, want := range map[string]bool{"cover": false, "clip": false, "tracks": false,
		"probe": true, "preview": true, "convert": true, "online": true} {
		if u.Finished(kind) != want {
			t.Errorf("finished %s = %v", kind, !want)
		}
	}
	// The other automatic subtitle is not lost with the copied one.
	if len(u.Auto) != 1 {
		t.Errorf("automatic subtitles = %+v", u.Auto)
	}
}

// A job with no file to show stays done: a video that plays as it is, too short
// for a clip.
func TestReuseOfAJobWithNoFile(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	code := fx.folder(t)
	if err := fx.root.PutBytes(code, content.FileCover, []byte("made")); err != nil {
		t.Fatal(err)
	}
	fx.exec(t, `UPDATE videos SET duration = 3, width = 10, height = 10, video_codec = 'h264', cover = ? WHERE id = ?`,
		content.Stored(code, content.FileCover, ""), fx.id)
	for _, kind := range []string{"probe", "cover", "preview", "clip", "tracks", "convert"} {
		fx.exec(t, `INSERT INTO jobs (video_id, kind, state, updated_at) VALUES (?, ?, 'done', 1)`, fx.id, kind)
	}
	fx.exec(t, `INSERT INTO jobs (video_id, kind, state, updated_at) VALUES (?, 'online', 'pending', 1)`, fx.id)
	if err := content.SaveManifest(context.Background(), fx.db, fx.root, fx.id); err != nil {
		t.Fatal(err)
	}
	u := fx.reuse(t)
	if u == nil {
		t.Fatal("nothing reused")
	}
	for _, kind := range []string{"probe", "cover", "preview", "clip", "tracks", "convert"} {
		if !u.Finished(kind) {
			t.Errorf("job %s not finished", kind)
		}
	}
	if u.Finished("online") {
		t.Error("a job still waiting is not finished")
	}
}

// A job whose file is in the old flat folders is not reused: those files are not
// in the folder that travels.
func TestAFlatFileIsNotCountedAsDone(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	fx.folder(t)
	fx.exec(t, `UPDATE videos SET cover = '1-a1b2c3d4.jpg', duration = 1, video_codec = 'h264' WHERE id = ?`, fx.id)
	for _, kind := range []string{"probe", "cover"} {
		fx.exec(t, `INSERT INTO jobs (video_id, kind, state, updated_at) VALUES (?, ?, 'done', 1)`, fx.id, kind)
	}
	if err := content.SaveManifest(context.Background(), fx.db, fx.root, fx.id); err != nil {
		t.Fatal(err)
	}
	u := fx.reuse(t)
	if u == nil || u.Finished("cover") || !u.Finished("probe") || u.Cover != "" {
		t.Errorf("reused = %+v", u)
	}
}

// The code counts, not the name of the folder.
func TestReuseOfAFolderWithAnotherName(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	code := fx.fullFolder(t)
	from := filepath.Dir(fx.root.FileIn(code, content.FileManifest))
	if err := os.Rename(from, filepath.Join(fx.root.VideoFolders(), "Copiato da me ["+code+"]")); err != nil {
		t.Fatal(err)
	}
	u := fx.reuse(t)
	if u == nil || u.Folder != "Copiato da me ["+code+"]" || u.Cover == "" {
		t.Errorf("reused = %+v", u)
	}
}

// A video.json damaged, newer or of another content: not adopted, not rewritten,
// not deleted, and the video gets a folder of its own.
func TestAFolderThatCannotBeTrustedIsLeftAlone(t *testing.T) {
	for name, text := range map[string]string{
		"damaged":  `{"version":1,"fingerprint":"` + fingerprintOld,
		"newer":    `{"version":2,"fingerprint":"` + fingerprintOld + `","cover":{"file":"copertina.jpg"}}`,
		"no owner": `{"version":1}`,
		"another":  `{"version":1,"fingerprint":"v1:00000000000000000000bbbba1b2c3d4"}`,
	} {
		t.Run(name, func(t *testing.T) {
			fx := newManifestFixture(t, "mare.mp4")
			dir := filepath.Join(fx.root.VideoFolders(), "Qualcosa [a1b2c3d4]")
			if err := os.MkdirAll(dir, 0o750); err != nil {
				t.Fatal(err)
			}
			file := filepath.Join(dir, content.FileManifest)
			if err := os.WriteFile(file, []byte(text), 0o600); err != nil {
				t.Fatal(err)
			}
			u := fx.reuse(t)
			if name == "another" {
				if u != nil {
					t.Errorf("reused = %+v", u)
				}
			} else if u == nil || !u.Unreadable || u.Cover != "" || u.Access != nil {
				t.Errorf("reused = %+v, want only that it cannot be read", u)
			}
			code := fx.folder(t)
			if code == "a1b2c3d4" {
				t.Error("the video took the folder it cannot trust")
			}
			if len(code) <= 8 {
				t.Errorf("code = %q, want a longer one", code)
			}
			if err := content.SaveManifest(context.Background(), fx.db, fx.root, fx.id); err != nil {
				t.Fatal(err)
			}
			if got, err := os.ReadFile(file); err != nil || string(got) != text {
				t.Errorf("video.json = %q, %v", got, err)
			}
			if name != "another" && !strings.Contains(fx.logs.String(), "left as it is") {
				t.Errorf("not in the logs: %s", fx.logs)
			}
		})
	}
}

// Saving again what is already written leaves the file as it is, with its date.
func TestSavingTheSameManifestLeavesTheFile(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	code := fx.fullFolder(t)
	file := fx.root.FileIn(code, content.FileManifest)
	old := time.Date(2020, 1, 2, 3, 4, 5, 0, time.UTC)
	if err := os.Chtimes(file, old, old); err != nil {
		t.Fatal(err)
	}
	if err := content.SaveManifest(context.Background(), fx.db, fx.root, fx.id); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(file)
	if err != nil || !info.ModTime().Equal(old) {
		t.Errorf("date = %v, %v", info.ModTime(), err)
	}
}

// place makes a folder of contents by hand. text is its video.json, if any.
func (fx *manifestFixture) place(t *testing.T, name, text string) string {
	t.Helper()
	dir := filepath.Join(fx.root.VideoFolders(), name)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if text != "" {
		if err := os.WriteFile(filepath.Join(dir, content.FileManifest), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func manifestOf(fingerprint string) string {
	return `{"version":1,"fingerprint":"` + fingerprint + `"}`
}

// Only a folder the database saw lose its video goes. Whatever else there is
// stays, even with a full database.
func TestRemoveRetiredFolders(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	fx := newManifestFixture(t, "mare.mp4")
	used := fx.folder(t)
	retired := func(fingerprint string, at time.Time) {
		t.Helper()
		fx.exec(t, `INSERT INTO retired_folders (fingerprint, remove_after) VALUES (?, ?)`, fingerprint, at.Unix())
	}
	forgotten := fx.place(t, "Dimenticato [11111111]", manifestOf("v1:11111111"))
	retired("v1:11111111", now.Add(-time.Hour))
	waiting := fx.place(t, "Sostituito da poco [22222222]", manifestOf("v1:22222222"))
	retired("v1:22222222", now.Add(time.Hour))
	named := fx.place(t, "Ancora chiamato [33333333]", manifestOf("v1:33333333"))
	retired("v1:33333333", now.Add(-time.Hour))
	fx.exec(t, `UPDATE videos SET cover = '33333333/copertina.jpg?v=s1' WHERE id = ?`, fx.id)
	retired(fingerprintOld, now.Add(-time.Hour)) // the video came back
	unknown := fx.place(t, "Mai vista [44444444]", manifestOf("v1:44444444"))
	damaged := fx.place(t, "Rotta [55555555]", `{"version":1,`)
	retired("v1:55555555", now.Add(-time.Hour))
	foreign := fx.place(t, "Cartella di qualcuno", "")
	flat := filepath.Join(string(fx.root), "covers", "1-a1b2c3d4.jpg")
	if err := os.MkdirAll(filepath.Dir(flat), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(flat, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}

	removed, err := content.RemoveRetiredFolders(ctx, fx.db, fx.root, now)
	if err != nil || removed != 1 {
		t.Fatalf("removed %d, %v; want 1", removed, err)
	}
	if _, err := os.Stat(forgotten); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("%s still there: %v", forgotten, err)
	}
	for _, kept := range []string{waiting, named, unknown, damaged, foreign, flat, fx.root.FileIn(used, content.FileManifest)} {
		if _, err := os.Stat(kept); err != nil {
			t.Errorf("%s went: %v", kept, err)
		}
	}
	// Who waits stays in the list; who is settled does not.
	var left []string
	rows, err := fx.db.Query(`SELECT fingerprint FROM retired_folders ORDER BY fingerprint`)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			t.Error(err)
		}
	}()
	for rows.Next() {
		var f string
		if err := rows.Scan(&f); err != nil {
			t.Fatal(err)
		}
		left = append(left, f)
	}
	if !slices.Equal(left, []string{"v1:22222222", "v1:33333333"}) {
		t.Errorf("left = %q", left)
	}
}

// A row deleted says its folder may go, at the next start.
func TestAVideoGoneRetiresItsFolder(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	fx.folder(t)
	fx.exec(t, `DELETE FROM videos`)
	removed, err := content.RemoveRetiredFolders(context.Background(), fx.db, fx.root, time.Now().Add(time.Minute))
	if err != nil || removed != 1 {
		t.Errorf("removed %d, %v", removed, err)
	}
	if names := fx.names(t); len(names) != 0 {
		t.Errorf("folders = %q", names)
	}
}

func (fx *manifestFixture) plan(t *testing.T) content.Cleaning {
	t.Helper()
	plan, err := content.PlanCleaning(context.Background(), fx.db, fx.root, time.Now(),
		slog.New(slog.NewTextHandler(fx.logs, nil)))
	if err != nil {
		t.Fatal(err)
	}
	return plan
}

func (fx *manifestFixture) flatFile(t *testing.T) {
	t.Helper()
	if err := os.MkdirAll(fx.root.Covers(), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(fx.root.Covers(), "1-a1b2c3d4.jpg"), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
}

// With a full database the cleanings run as always.
func TestCleaningWithAFullDatabase(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	fx.flatFile(t)
	if plan := fx.plan(t); !plan.Folders || !plan.Flat {
		t.Errorf("plan = %+v", plan)
	}
}

// An empty database cleans nothing. The flat files it finds stay at every start
// from then on, also when the first scan has filled it.
func TestCleaningWithAnEmptyDatabaseHoldsTheFlatFiles(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	fx.exec(t, `DELETE FROM videos`)
	fx.flatFile(t)
	if plan := fx.plan(t); plan.Folders || plan.Flat {
		t.Errorf("empty: plan = %+v", plan)
	}
	if !strings.Contains(fx.logs.String(), "count=1") || !strings.Contains(fx.logs.String(), fx.root.Covers()) {
		t.Errorf("how many and where are not in the logs: %s", fx.logs)
	}
	fx.exec(t, `INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, added_at)
		VALUES (?, 1, 'mare.mp4', 1, 1, 'Il mare', 1)`, fingerprintOld)
	if plan := fx.plan(t); !plan.Folders || plan.Flat {
		t.Errorf("after the first scan: plan = %+v", plan)
	}
}

// An empty database with no flat file has nothing to hold: from the next start,
// with its videos, it cleans as usual.
func TestCleaningWithAnEmptyDatabaseAndNoFlatFiles(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	fx.exec(t, `DELETE FROM videos`)
	if plan := fx.plan(t); plan.Folders || plan.Flat {
		t.Errorf("empty: plan = %+v", plan)
	}
	fx.exec(t, `INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, added_at)
		VALUES (?, 1, 'mare.mp4', 1, 1, 'Il mare', 1)`, fingerprintOld)
	if plan := fx.plan(t); !plan.Folders || !plan.Flat {
		t.Errorf("with videos: plan = %+v", plan)
	}
}

func TestLeftovers(t *testing.T) {
	ctx := context.Background()
	fx := newManifestFixture(t, "mare.mp4")
	fx.fullFolder(t)
	fx.place(t, "Da copiare [11111111]", `{"version":1,"fingerprint":"v1:11111111","title":"Un film"}`)
	if err := os.WriteFile(filepath.Join(fx.root.VideoFolders(), "Da copiare [11111111]", "copertina.jpg"), bytes.Repeat([]byte("x"), 1000), 0o600); err != nil {
		t.Fatal(err)
	}
	fx.place(t, "Rotta [22222222]", `{"version":1,`)
	fx.place(t, "Nuova versione [33333333]", `{"version":9,"fingerprint":"v1:33333333","title":"Dal futuro"}`)
	fx.place(t, "Cartella di qualcuno", "")
	fx.place(t, ".new-123", "")
	if err := os.WriteFile(filepath.Join(fx.root.VideoFolders(), "un file.txt"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}

	list, total, err := content.Leftovers(ctx, fx.db, fx.root, 200)
	if err != nil || total != 4 || len(list) != 4 {
		t.Fatalf("leftovers = %+v, %d, %v", list, total, err)
	}
	byName := map[string]content.Leftover{}
	for _, l := range list {
		byName[filepath.Base(l.Path)] = l
	}
	if l := byName["Da copiare [11111111]"]; l.Title != "Un film" || l.Size < 1000 {
		t.Errorf("leftover = %+v", l)
	}
	if l := byName["Da copiare [11111111]"]; l.Unreadable {
		t.Errorf("readable = %+v", l)
	}
	if l := byName["Rotta [22222222]"]; l.Title != "" || !l.Unreadable {
		t.Errorf("damaged = %+v", l)
	}
	if l := byName["Nuova versione [33333333]"]; l.Title != "Dal futuro" || !l.Unreadable {
		t.Errorf("newer = %+v", l)
	}
	if l, ok := byName["Cartella di qualcuno"]; !ok || l.Unreadable {
		t.Errorf("foreign folder: %+v in %+v", l, list)
	}

	// Only so many are listed, all of them are counted.
	for i := range 3 {
		fx.place(t, "Altra "+strconv.Itoa(i), "")
	}
	list, total, err = content.Leftovers(ctx, fx.db, fx.root, 2)
	if err != nil || total != 7 || len(list) != 2 {
		t.Errorf("limit: %d of %d, %v", len(list), total, err)
	}
}

// A second folder with one code cannot be told from the first by the index, but
// it is still shown: it holds something and has no video.
func TestLeftoversShowsAFolderWithACodeTaken(t *testing.T) {
	fx := newManifestFixture(t, "mare.mp4")
	fx.fullFolder(t)
	fx.place(t, "zzz copia [a1b2c3d4]", manifestOf(fingerprintOld))
	list, total, err := content.Leftovers(context.Background(), fx.db, fx.root, 10)
	if err != nil || total != 1 || filepath.Base(list[0].Path) != "zzz copia [a1b2c3d4]" {
		t.Errorf("leftovers = %+v, %d, %v", list, total, err)
	}
}
