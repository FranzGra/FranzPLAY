package library

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/database"
)

// testScanner is a scanner on a fresh database, with a clock the test controls.
type testScanner struct {
	*Scanner
	db    *sql.DB
	clock time.Time
}

func newTestScanner(t *testing.T, libraries ...string) *testScanner {
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
	ts := &testScanner{db: db, clock: time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)}
	ts.Scanner = NewScanner(db, libraries, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ts.now = func() time.Time { return ts.clock }
	return ts
}

func (ts *testScanner) scan(t *testing.T, want Report) {
	t.Helper()
	got, err := ts.Scan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("scan report\n got  %+v\n want %+v", got, want)
	}
}

// videoRow is what the catalog says about one video.
type videoRow struct {
	id       int64
	path     string
	title    string
	category string
	missing  bool
}

func (ts *testScanner) videos(t *testing.T) map[string]videoRow {
	t.Helper()
	rows, err := ts.db.Query(`SELECT id, path, title, category, missing_since IS NOT NULL FROM videos`)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			t.Error(err)
		}
	}()
	out := map[string]videoRow{}
	for rows.Next() {
		var v videoRow
		if err := rows.Scan(&v.id, &v.path, &v.title, &v.category, &v.missing); err != nil {
			t.Fatal(err)
		}
		out[v.path] = v
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func move(t *testing.T, root, from, to string) {
	t.Helper()
	dst := filepath.Join(root, filepath.FromSlash(to))
	if err := os.MkdirAll(filepath.Dir(dst), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(filepath.Join(root, filepath.FromSlash(from)), dst); err != nil {
		t.Fatal(err)
	}
}

func TestScanAddsVideos(t *testing.T) {
	lib := t.TempDir()
	writeFile(t, lib, "mare.mp4", "sea")
	writeFile(t, lib, "Viaggi/2025/Sardegna.mkv", "sardinia")
	writeFile(t, lib, "Viaggi/cover.jpg", "not a video")
	ts := newTestScanner(t, lib)

	ts.scan(t, Report{Added: 2})

	got := ts.videos(t)
	if v := got["Viaggi/2025/Sardegna.mkv"]; v.title != "Sardegna" || v.category != "Viaggi" || v.missing {
		t.Errorf("Sardegna = %+v", v)
	}
	if v := got["mare.mp4"]; v.title != "mare" || v.category != "" {
		t.Errorf("mare = %+v", v)
	}

	// Nothing changed: the second scan only compares names, sizes and dates.
	ts.scan(t, Report{Unchanged: 2})
}

func TestScanKeepsTheSameVideoWhenMoved(t *testing.T) {
	lib := t.TempDir()
	writeFile(t, lib, "mare.mp4", "sea")
	ts := newTestScanner(t, lib)
	ts.scan(t, Report{Added: 1})
	before := ts.videos(t)["mare.mp4"]

	move(t, lib, "mare.mp4", "Viaggi/Il mare d'estate.mp4")
	ts.scan(t, Report{Moved: 1})

	after := ts.videos(t)["Viaggi/Il mare d'estate.mp4"]
	if after.id != before.id {
		t.Errorf("moved video has id %d, want %d (same video)", after.id, before.id)
	}
	if after.title != "Il mare d'estate" || after.category != "Viaggi" {
		t.Errorf("moved video = %+v, want new title and category", after)
	}
}

func TestScanKeepsTheTitleOfAnUploadedVideo(t *testing.T) {
	uploads := t.TempDir()
	writeFile(t, uploads, "7/12.mp4", "sea")
	ts := newTestScanner(t, uploads)
	ts.scan(t, Report{Added: 1})
	if _, err := ts.db.Exec(`INSERT INTO users (id, name, password_hash, role, created_at) VALUES (7, 'Giulia', 'x', 'user', 1)`); err != nil {
		t.Fatal(err)
	}
	if _, err := ts.db.Exec(`UPDATE videos SET uploaded_by = 7, title = 'Al mare', category = ''`); err != nil {
		t.Fatal(err)
	}

	move(t, uploads, "7/12.mp4", "7/old/12.mp4")
	ts.scan(t, Report{Moved: 1})

	if v := ts.videos(t)["7/old/12.mp4"]; v.title != "Al mare" || v.category != "" {
		t.Errorf("moved uploaded video = %+v, want the title its person gave and no category", v)
	}
}

func TestScanSwappedNames(t *testing.T) {
	lib := t.TempDir()
	writeFile(t, lib, "a.mp4", "first")
	writeFile(t, lib, "b.mp4", "second")
	ts := newTestScanner(t, lib)
	ts.scan(t, Report{Added: 2})
	before := ts.videos(t)

	move(t, lib, "a.mp4", "tmp.mp4")
	move(t, lib, "b.mp4", "a.mp4")
	move(t, lib, "tmp.mp4", "b.mp4")
	ts.scan(t, Report{Moved: 2})

	after := ts.videos(t)
	if after["a.mp4"].id != before["b.mp4"].id || after["b.mp4"].id != before["a.mp4"].id {
		t.Errorf("after swapping names: %+v, before: %+v", after, before)
	}
}

func TestScanMissingVideoComesBackAndIsForgottenOnlyAfterDays(t *testing.T) {
	lib := t.TempDir()
	writeFile(t, lib, "keep.mp4", "keep")
	name := writeFile(t, lib, "mare.mp4", "sea")
	ts := newTestScanner(t, lib)
	ts.scan(t, Report{Added: 2})
	id := ts.videos(t)["mare.mp4"].id

	// The file disappears: the video is marked missing, not deleted.
	stash := filepath.Join(t.TempDir(), "mare.mp4")
	if err := os.Rename(name, stash); err != nil {
		t.Fatal(err)
	}
	ts.scan(t, Report{Unchanged: 1, Missing: 1})
	if v := ts.videos(t)["mare.mp4"]; !v.missing || v.id != id {
		t.Fatalf("after removal: %+v, want the same video marked missing", v)
	}

	// It comes back a week later: same video, likes and comments included.
	ts.clock = ts.clock.Add(7 * 24 * time.Hour)
	if err := os.Rename(stash, name); err != nil {
		t.Fatal(err)
	}
	ts.scan(t, Report{Unchanged: 1, Restored: 1})
	if v := ts.videos(t)["mare.mp4"]; v.missing || v.id != id {
		t.Fatalf("after coming back: %+v, want the same video present", v)
	}

	// It disappears for good: still kept just before the limit, forgotten after.
	if err := os.Remove(name); err != nil {
		t.Fatal(err)
	}
	ts.scan(t, Report{Unchanged: 1, Missing: 1})
	ts.clock = ts.clock.Add(ForgetAfter - time.Hour)
	ts.scan(t, Report{Unchanged: 1})
	ts.clock = ts.clock.Add(2 * time.Hour)
	ts.scan(t, Report{Unchanged: 1, Forgotten: 1})
	if _, ok := ts.videos(t)["mare.mp4"]; ok {
		t.Error("video missing for more than ForgetAfter is still in the catalog")
	}
}

func TestScanDoesNotMarkMissingWhenTheDiskIsNotMounted(t *testing.T) {
	parent := t.TempDir()
	lib := filepath.Join(parent, "disk")
	writeFile(t, lib, "mare.mp4", "sea")
	ts := newTestScanner(t, lib)
	ts.scan(t, Report{Added: 1})

	// The folder exists but is empty, like a mount point without its disk.
	stash := filepath.Join(parent, "unplugged")
	if err := os.Rename(lib, stash); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(lib, 0o750); err != nil {
		t.Fatal(err)
	}
	ts.scan(t, Report{})

	// The folder does not exist at all.
	if err := os.Remove(lib); err != nil {
		t.Fatal(err)
	}
	ts.scan(t, Report{Problems: 1})

	if v := ts.videos(t)["mare.mp4"]; v.missing {
		t.Error("video marked missing while its disk was not mounted")
	}
}

func TestScanLibraryRemovedFromSettings(t *testing.T) {
	first, second := t.TempDir(), t.TempDir()
	writeFile(t, first, "a.mp4", "a")
	writeFile(t, second, "b.mp4", "b")
	ts := newTestScanner(t, first, second)
	ts.scan(t, Report{Added: 2})

	ts.libraries = []string{second}
	ts.scan(t, Report{Unchanged: 1, Missing: 1})
	if !ts.videos(t)["a.mp4"].missing {
		t.Error("video of a removed library is not marked missing")
	}
}

func TestScanDuplicateCopies(t *testing.T) {
	lib := t.TempDir()
	writeFile(t, lib, "mare.mp4", "sea")
	writeFile(t, lib, "Copia/mare.mp4", "sea")
	ts := newTestScanner(t, lib)

	ts.scan(t, Report{Added: 1, Duplicates: 1})
	if len(ts.videos(t)) != 1 {
		t.Errorf("catalog has %d videos, want 1", len(ts.videos(t)))
	}
}

// snapshot describes every file and folder under root: name, size,
// permissions and date. Two equal snapshots mean nothing was touched.
func snapshot(t *testing.T, root string) map[string]string {
	t.Helper()
	out := map[string]string{}
	err := filepath.WalkDir(root, func(name string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		out[name] = fmt.Sprintf("%s %s %d", info.Mode(), info.ModTime(), info.Size())
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// Rule 1: video folders are read-only. A scan must leave them exactly as
// they were, whatever it finds.
func TestScanNeverChangesTheVideoFolder(t *testing.T) {
	lib := t.TempDir()
	writeFile(t, lib, "mare.mp4", "sea")
	writeFile(t, lib, "Viaggi/montagna.mkv", "mountain")
	writeFile(t, lib, "Viaggi/montagna.srt", "subtitles")
	writeFile(t, lib, "Copia/mare.mp4", "sea")
	ts := newTestScanner(t, lib)

	before := snapshot(t, lib)
	ts.scan(t, Report{Added: 2, Duplicates: 1})
	sameSnapshot(t, before, snapshot(t, lib))

	move(t, lib, "Viaggi/montagna.mkv", "montagna.mkv")
	before = snapshot(t, lib)
	ts.scan(t, Report{Unchanged: 1, Moved: 1, Duplicates: 1})
	sameSnapshot(t, before, snapshot(t, lib))
}

func sameSnapshot(t *testing.T, before, after map[string]string) {
	t.Helper()
	if len(after) != len(before) {
		t.Fatalf("folder had %d entries, now %d", len(before), len(after))
	}
	for name, desc := range before {
		if after[name] != desc {
			t.Errorf("%s changed: %q, now %q", name, desc, after[name])
		}
	}
}

// countingFS counts how many files are opened, to check what a scan reads.
type countingFS struct {
	fs.FS
	opened *int
}

func (c countingFS) Open(name string) (fs.File, error) {
	f, err := c.FS.Open(name)
	if err == nil {
		if info, statErr := f.Stat(); statErr == nil && !info.IsDir() {
			*c.opened++
		}
	}
	return f, err
}

func TestScanOfAnUnchangedLibraryReadsNoVideo(t *testing.T) {
	lib := t.TempDir()
	writeFile(t, lib, "a.mp4", "a")
	writeFile(t, lib, "b.mp4", "b")
	ts := newTestScanner(t, lib)
	opened := 0
	ts.open = func(dir string) fs.FS { return countingFS{FS: os.DirFS(dir), opened: &opened} }

	ts.scan(t, Report{Added: 2})
	if opened != 2 {
		t.Errorf("first scan opened %d videos, want 2", opened)
	}
	opened = 0
	ts.scan(t, Report{Unchanged: 2})
	if opened != 0 {
		t.Errorf("scan of an unchanged library opened %d videos, want 0", opened)
	}
}

func (ts *testScanner) probeJobs(t *testing.T) map[string]string {
	t.Helper()
	return ts.jobs(t, "probe")
}

// jobs returns the state of the jobs of a kind, by video path.
func (ts *testScanner) jobs(t *testing.T, kind string) map[string]string {
	t.Helper()
	rows, err := ts.db.Query(`SELECT v.path, j.state FROM jobs j JOIN videos v ON v.id = j.video_id WHERE j.kind = ?`, kind)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			t.Error(err)
		}
	}()
	out := map[string]string{}
	for rows.Next() {
		var path, state string
		if err := rows.Scan(&path, &state); err != nil {
			t.Fatal(err)
		}
		out[path] = state
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestScanAsksToReadNewAndChangedVideos(t *testing.T) {
	lib := t.TempDir()
	writeFile(t, lib, "a.mp4", "a")
	writeFile(t, lib, "b.mp4", "b")
	ts := newTestScanner(t, lib)
	woken, changed := 0, 0
	ts.OnNewJobs(func() { woken++ })
	ts.OnChange(func() { changed++ })

	ts.scan(t, Report{Added: 2})
	if got := ts.probeJobs(t); len(got) != 2 || got["a.mp4"] != "pending" || got["b.mp4"] != "pending" {
		t.Fatalf("probe jobs = %v, want one pending per new video", got)
	}
	if woken != 1 || changed != 1 {
		t.Errorf("worker woken %d times, pages told %d times; want 1 and 1", woken, changed)
	}
	ts.scan(t, Report{Unchanged: 2})
	if changed != 1 {
		t.Errorf("pages told %d times after a scan that changed nothing, want still 1", changed)
	}

	// The jobs are done; then a.mp4 is replaced and b.mp4 renamed.
	if _, err := ts.db.Exec(`UPDATE jobs SET state = 'done'`); err != nil {
		t.Fatal(err)
	}
	writeFile(t, lib, "a.mp4", "a, new version")
	move(t, lib, "b.mp4", "c.mp4")
	ts.scan(t, Report{Moved: 1, Updated: 1})

	got := ts.probeJobs(t)
	if got["a.mp4"] != "pending" {
		t.Errorf("replaced video: probe job %q, want pending", got["a.mp4"])
	}
	if got["c.mp4"] != "done" {
		t.Errorf("renamed video: probe job %q, want still done (same content)", got["c.mp4"])
	}

	ts.scan(t, Report{Unchanged: 2})
	if woken != 2 {
		t.Errorf("worker woken %d times, want 2 (not on an unchanged scan)", woken)
	}
}

func TestScanAsksForWhatFailedWhileAVideoWasMissing(t *testing.T) {
	lib := t.TempDir()
	name := writeFile(t, lib, "film.mkv", "film")
	writeFile(t, lib, "altro.mp4", "other") // so the folder never looks unplugged
	ts := newTestScanner(t, lib)
	ts.scan(t, Report{Added: 2})
	stash := filepath.Join(t.TempDir(), "film.mkv")
	if err := os.Rename(name, stash); err != nil {
		t.Fatal(err)
	}
	ts.scan(t, Report{Unchanged: 1, Missing: 1})
	// It was read before going missing; its subtitles failed while it was away.
	if _, err := ts.db.Exec(`UPDATE jobs SET state = 'done' WHERE kind = 'probe';
		INSERT INTO jobs (video_id, kind, state, updated_at) SELECT id, 'tracks', 'failed', 1 FROM videos WHERE path = 'film.mkv'`); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(stash, name); err != nil {
		t.Fatal(err)
	}
	ts.scan(t, Report{Unchanged: 1, Restored: 1})
	if got := ts.jobs(t, "probe")["film.mkv"]; got != "done" {
		t.Errorf("probe job %q, want still done (same content)", got)
	}
	if got := ts.jobs(t, "tracks")["film.mkv"]; got != "pending" {
		t.Errorf("subtitles job %q, want pending again", got)
	}
}
