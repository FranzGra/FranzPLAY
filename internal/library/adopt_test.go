package library

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/content"
)

// adoptFixture is a scanner that reuses from a folder of contents.
type adoptFixture struct {
	*testScanner
	root    content.Root
	library string
	logs    *bytes.Buffer
}

func newAdoptFixture(t *testing.T) *adoptFixture {
	t.Helper()
	library := t.TempDir()
	fx := &adoptFixture{testScanner: newTestScanner(t, library), root: content.Root(t.TempDir()), library: library, logs: &bytes.Buffer{}}
	logger := slog.New(slog.NewTextHandler(fx.logs, nil))
	fx.logger, fx.store.logger = logger, logger
	fx.ReuseFrom(func(ctx context.Context, fingerprints []string) (map[string]*content.Reused, error) {
		return fx.root.Reuse(ctx, fingerprints, logger)
	})
	fx.OnScanned(func(ctx context.Context, moved, replaced []int64) {
		content.AfterScan(ctx, fx.db, fx.root, moved, replaced, logger)
	})
	return fx
}

// fingerprintOf is what the scan will read for a video put in the library.
func (fx *adoptFixture) addVideo(t *testing.T, rel string) string {
	t.Helper()
	file := filepath.Join(fx.library, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(file), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte("the content of a video"), 0o600); err != nil {
		t.Fatal(err)
	}
	old := fx.clock.Add(-48 * 3600 * 1e9)
	if err := os.Chtimes(file, old, old); err != nil {
		t.Fatal(err)
	}
	fp, err := Fingerprint(os.DirFS(fx.library), rel)
	if err != nil {
		t.Fatal(err)
	}
	return fp
}

// folderFor makes the folder a finished video leaves, by hand: another
// installation, or this one before it lost its database.
func (fx *adoptFixture) folderFor(t *testing.T, fingerprint, name string, change func(m *content.Manifest)) string {
	t.Helper()
	code := fingerprint[len(fingerprint)-8:]
	dir := filepath.Join(fx.root.VideoFolders(), name+" ["+code+"]")
	if err := os.MkdirAll(filepath.Join(dir, "sottotitoli"), 0o750); err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{content.FileCover, content.FileTimeline, content.FileClip, content.FileClipHD,
		content.FileConverted, content.FileOwnCover + ".png", content.InsideSubtitleFile(2), content.AutoSubtitleFile("it")} {
		if err := os.WriteFile(filepath.Join(dir, filepath.FromSlash(file)), []byte("made"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	second, title, category, picture, stream := int64(42), "Il mio mare", "Viaggi", "", int64(2)
	m := content.Manifest{
		Version: content.ManifestVersion, Fingerprint: fingerprint, Library: "/altrove", Path: "vecchio.mp4", Title: title,
		Done: []string{"probe", "online", "cover", "preview", "clip", "tracks", "convert"},
		Info: &content.Info{Duration: 2880, Width: 1920, Height: 1080, VideoCodec: "hevc", AudioCodec: "ac3", Container: "matroska", PixelFormat: "yuv420p"},
		Choices: content.Choices{CoverFile: content.FileOwnCover + ".png", CoverVersion: "own1", CoverSecond: &second,
			Title: &title, Category: &category},
		CoverImage: &picture,
		Cover:      &content.File{File: content.FileCover, Version: "s1"},
		Timeline:   &content.Timeline{File: content.FileTimeline, Version: "s2", Gap: 10, Count: 288, Width: 320, Height: 180},
		Clip:       &content.File{File: content.FileClip, Version: "s3"},
		ClipHD:     &content.File{File: content.FileClipHD, Version: "s3"},
		Converted:  &content.File{File: content.FileConverted},
		Audio:      []content.Audio{{Stream: 1, Lang: "it", Codec: "ac3", Channels: 6, Default: true}},
		Subtitles: []content.Subtitle{
			{File: content.InsideSubtitleFile(2), Lang: "en", Stream: &stream, Title: "Inglese"},
			{File: content.AutoSubtitleFile("it"), Lang: "it", Model: "base", MadeAt: 77},
		},
	}
	if change != nil {
		change(&m)
	}
	data, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, content.FileManifest), data, 0o600); err != nil {
		t.Fatal(err)
	}
	return code
}

// firstScan scans twice: the first scan sees a file new, the second trusts it.
func (fx *adoptFixture) firstScan(t *testing.T) {
	t.Helper()
	if _, err := fx.Scan(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func (fx *adoptFixture) jobsByState(t *testing.T, state string) []string {
	t.Helper()
	rows, err := fx.db.Query(`SELECT kind FROM jobs WHERE state = ? ORDER BY kind`, state)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			t.Error(err)
		}
	}()
	var kinds []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			t.Fatal(err)
		}
		kinds = append(kinds, k)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return kinds
}

func (fx *adoptFixture) one(t *testing.T, query string, into ...any) {
	t.Helper()
	if err := fx.db.QueryRow(query).Scan(into...); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
}

func TestAScanPutsAVideoBackFromItsFolder(t *testing.T) {
	fx := newAdoptFixture(t)
	fp := fx.addVideo(t, "Viaggi/mare.mp4")
	code := fx.folderFor(t, fp, "Nome vecchio", nil)
	fx.firstScan(t)

	// Nothing heavy is asked again: only the file next to the video is read.
	if got := fx.jobsByState(t, "pending"); !slices.Equal(got, []string{"details"}) {
		t.Errorf("waiting jobs = %q", got)
	}
	if got := fx.jobsByState(t, "done"); !slices.Equal(got, []string{"clip", "convert", "cover", "online", "preview", "probe", "tracks"}) {
		t.Errorf("jobs done = %q", got)
	}
	var cover, preview, clip, clipHD, converted, own, title, category, codec, image string
	var duration, gap, count, second int64
	fx.one(t, `SELECT cover, preview, clip, clip_hd, converted, own_cover, admin_title, admin_category, video_codec,
		cover_image, duration, preview_gap, preview_count, cover_second FROM videos`,
		&cover, &preview, &clip, &clipHD, &converted, &own, &title, &category, &codec, &image, &duration, &gap, &count, &second)
	if cover != code+"/"+content.FileCover+"?v=s1" || preview != code+"/"+content.FileTimeline+"?v=s2" ||
		clip != code+"/"+content.FileClip+"?v=s3" || clipHD != code+"/"+content.FileClipHD+"?v=s3" ||
		converted != code+"/"+content.FileConverted || own != code+"/"+content.FileOwnCover+".png?v=own1" {
		t.Errorf("files: %q %q %q %q %q %q", cover, preview, clip, clipHD, converted, own)
	}
	if title != "Il mio mare" || category != "Viaggi" || codec != "hevc" || duration != 2880 || gap != 10 || count != 288 || second != 42 {
		t.Errorf("values: %q %q %q %d %d %d %d", title, category, codec, duration, gap, count, second)
	}
	var subs, autos, audios int
	fx.one(t, `SELECT (SELECT count(*) FROM video_subtitles), (SELECT count(*) FROM auto_subtitles),
		(SELECT count(*) FROM video_audio)`, &subs, &autos, &audios)
	if subs != 1 || autos != 1 || audios != 1 {
		t.Errorf("subtitles %d, automatic %d, audio %d", subs, autos, audios)
	}
	// The automatic subtitles belong to this content, and nobody asks for them.
	var model, owner string
	var requests, transcribe int
	fx.one(t, `SELECT model, fingerprint FROM auto_subtitles`, &model, &owner)
	fx.one(t, `SELECT (SELECT count(*) FROM subtitle_requests),
		(SELECT count(*) FROM jobs WHERE kind IN ('transcribe', 'translate'))`, &requests, &transcribe)
	if model != "base" || owner != fp || requests != 0 || transcribe != 0 {
		t.Errorf("model %q, owner %q, requests %d, jobs %d", model, owner, requests, transcribe)
	}
	// The name of the folder follows the file, and video.json where it is now.
	want := filepath.Join(fx.root.VideoFolders(), "mare ["+code+"]")
	data, err := os.ReadFile(filepath.Join(want, content.FileManifest))
	if err != nil {
		t.Fatal(err)
	}
	var m content.Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}
	if m.Path != "Viaggi/mare.mp4" || m.Library != fx.library {
		t.Errorf("video.json says %q in %q", m.Path, m.Library)
	}
	// What the picture next to the video was is known: no new cover.
	fx.firstScan(t)
	if got := fx.jobsByState(t, "pending"); !slices.Equal(got, []string{"details"}) {
		t.Errorf("after another scan, waiting jobs = %q", got)
	}
}

// A file missing is made again by its job, and nothing else is.
func TestAScanAsksOnlyForWhatIsMissing(t *testing.T) {
	fx := newAdoptFixture(t)
	fp := fx.addVideo(t, "mare.mp4")
	code := fx.folderFor(t, fp, "mare", nil)
	if err := os.Remove(filepath.Join(fx.root.VideoFolders(), "mare ["+code+"]", content.FileClip)); err != nil {
		t.Fatal(err)
	}
	fx.firstScan(t)
	if got := fx.jobsByState(t, "pending"); !slices.Equal(got, []string{"clip", "details"}) {
		t.Errorf("waiting jobs = %q", got)
	}
}

// A video not read yet is read, and the rest follows as for any video; what its
// folder holds stays.
func TestAVideoNotReadYetIsRead(t *testing.T) {
	fx := newAdoptFixture(t)
	fp := fx.addVideo(t, "mare.mp4")
	fx.folderFor(t, fp, "mare", func(m *content.Manifest) { m.Info = nil })
	fx.firstScan(t)
	if got := fx.jobsByState(t, "pending"); !slices.Equal(got, []string{"details", "online", "probe"}) {
		t.Errorf("waiting jobs = %q", got)
	}
	var autos int
	fx.one(t, `SELECT count(*) FROM auto_subtitles`, &autos)
	if autos != 1 {
		t.Errorf("automatic subtitles = %d", autos)
	}
}

// A value the database refuses costs the adoption, not the scan: the video
// counts as new, the folder stays as it is.
func TestAValueTheDatabaseRefusesMakesTheVideoNew(t *testing.T) {
	fx := newAdoptFixture(t)
	fp := fx.addVideo(t, "mare.mp4")
	fx.folderFor(t, fp, "mare", func(m *content.Manifest) { empty := ""; m.Choices.Title = &empty })
	report, err := fx.Scan(context.Background())
	if err != nil || report.Added != 1 {
		t.Fatalf("scan = %+v, %v", report, err)
	}
	if got := fx.jobsByState(t, "pending"); !slices.Equal(got, []string{"details", "online", "probe"}) {
		t.Errorf("waiting jobs = %q", got)
	}
	var cover sql.NullString
	var autos int
	fx.one(t, `SELECT cover, (SELECT count(*) FROM auto_subtitles) FROM videos`, &cover, &autos)
	if cover.Valid || autos != 0 {
		t.Errorf("cover %v, automatic %d: half of the folder came", cover, autos)
	}
	if !strings.Contains(fx.logs.String(), "not reused") {
		t.Errorf("not in the logs: %s", fx.logs)
	}
}

// A folder that cannot say what it holds must not open what it was keeping
// closed: the video stays hidden, and the folder is not touched.
func TestAnUnreadableFolderKeepsItsVideoHidden(t *testing.T) {
	for name, damage := range map[string]string{
		"damaged": `{"version":1,`,
		"newer":   `{"version":99,"fingerprint":"x","access":{"private":false}}`,
	} {
		t.Run(name, func(t *testing.T) {
			fx := newAdoptFixture(t)
			fp := fx.addVideo(t, "mare.mp4")
			code := fx.folderFor(t, fp, "mare", func(m *content.Manifest) {
				m.Access = &content.Access{HiddenAt: 77}
			})
			dir := filepath.Join(fx.root.VideoFolders(), "mare ["+code+"]")
			manifest := filepath.Join(dir, content.FileManifest)
			if err := os.WriteFile(manifest, []byte(damage), 0o600); err != nil {
				t.Fatal(err)
			}
			fx.firstScan(t)

			var hidden sql.NullInt64
			var cover sql.NullString
			fx.one(t, `SELECT hidden_at, cover FROM videos`, &hidden, &cover)
			if !hidden.Valid || hidden.Int64 != fx.clock.Unix() {
				t.Errorf("hidden_at = %+v: an unreadable folder opened its video", hidden)
			}
			if cover.Valid {
				t.Errorf("cover = %q: something came from an unreadable folder", cover.String)
			}
			if got := fx.jobsByState(t, "pending"); !slices.Equal(got, []string{"details", "online", "probe"}) {
				t.Errorf("waiting jobs = %q", got)
			}
			if !strings.Contains(fx.logs.String(), "video hidden until an administrator shows it") {
				t.Errorf("not in the logs: %s", fx.logs)
			}
			data, err := os.ReadFile(manifest)
			if err != nil || string(data) != damage {
				t.Errorf("video.json = %q, %v: the folder was touched", data, err)
			}
		})
	}
}

// A good folder with a longer code wins over a damaged one with the short code,
// which may be anybody's.
func TestAGoodFolderWinsOverAnUnreadableOne(t *testing.T) {
	fx := newAdoptFixture(t)
	fp := fx.addVideo(t, "mare.mp4")
	long := fp[len(fp)-12:]
	dir := filepath.Join(fx.root.VideoFolders(), "mare ["+fp[len(fp)-8:]+"]")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, content.FileManifest), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	good := filepath.Join(fx.root.VideoFolders(), "mare ["+long+"]")
	if err := os.MkdirAll(good, 0o750); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(content.Manifest{Version: content.ManifestVersion, Fingerprint: fp, Path: "mare.mp4",
		Access: &content.Access{}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(good, content.FileManifest), data, 0o600); err != nil {
		t.Fatal(err)
	}
	fx.firstScan(t)
	var hidden sql.NullInt64
	fx.one(t, `SELECT hidden_at FROM videos`, &hidden)
	if hidden.Valid {
		t.Errorf("hidden_at = %d, the good folder says it is visible", hidden.Int64)
	}
}

// An uploaded video whose person has no account yet keeps its title and stays out
// of the categories, and what it writes in video.json says so the next time too.
func TestAnUploadWithNoAccountKeepsItsTitle(t *testing.T) {
	fx := newAdoptFixture(t)
	fp := fx.addVideo(t, "mare.mp4")
	fx.folderFor(t, fp, "mare", func(m *content.Manifest) {
		m.Title = "Il mio caricato"
		m.Choices.Title, m.Choices.Category = nil, nil
		m.Access = &content.Access{Private: true, UploadedBy: "sparito"}
	})
	fx.firstScan(t)

	var owner sql.NullInt64
	var private bool
	var shown, category string
	var adminTitle, adminCategory sql.NullString
	fx.one(t, `SELECT uploaded_by, private, shown_title, category, admin_title, admin_category FROM videos`,
		&owner, &private, &shown, &category, &adminTitle, &adminCategory)
	if owner.Valid || !private {
		t.Errorf("owner %+v, private %v: it must stay closed, with no owner", owner, private)
	}
	if shown != "Il mio caricato" || category != "" {
		t.Errorf("title %q, category %q", shown, category)
	}
	if adminTitle.String != "Il mio caricato" || !adminCategory.Valid {
		t.Errorf("admin title %+v, admin category %+v: the next video.json would lose them", adminTitle, adminCategory)
	}
}

// A replaced video's old folder goes on the list, for as long as a missing video
// is kept; a forgotten video's old folder, right away.
func TestTheDatabaseSaysWhichFoldersLostTheirVideo(t *testing.T) {
	fx := newAdoptFixture(t)
	fx.addVideo(t, "mare.mp4")
	old := fx.addVideo(t, "mare.mp4")
	fx.firstScan(t)
	file := filepath.Join(fx.library, "mare.mp4")
	if err := os.WriteFile(file, []byte("another content of a video"), 0o600); err != nil {
		t.Fatal(err)
	}
	fx.clock = fx.clock.Add(ForgetAfter / 30)
	mod := fx.clock.Add(-48 * 3600 * 1e9)
	if err := os.Chtimes(file, mod, mod); err != nil {
		t.Fatal(err)
	}
	fx.firstScan(t)
	fx.firstScan(t)
	var at int64
	fx.one(t, `SELECT remove_after FROM retired_folders WHERE fingerprint = '`+old+`'`, &at)
	if want := fx.clock.Add(ForgetAfter).Unix(); at != want {
		t.Errorf("remove after %d, want %d", at, want)
	}
	if _, err := fx.db.Exec(`DELETE FROM videos`); err != nil {
		t.Fatal(err)
	}
	var n int
	fx.one(t, `SELECT count(*) FROM retired_folders`, &n)
	if n != 2 {
		t.Errorf("retired folders = %d", n)
	}
}
