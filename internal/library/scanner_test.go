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
	"runtime"
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
	if _, err := ts.db.Exec(`UPDATE videos SET uploaded_by = 7, title = 'Al mare', folder_category = ''`); err != nil {
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

// TestScanAddsAndForgetsManyVideosABatchAtATime: big changes are saved in
// several short transactions, and nothing is lost or counted twice.
func TestScanAddsAndForgetsManyVideosABatchAtATime(t *testing.T) {
	lib := t.TempDir()
	writeFile(t, lib, "keep.mp4", "keep")
	var names []string
	for i := range 7 {
		names = append(names, writeFile(t, lib, fmt.Sprintf("Viaggi/v%d.mp4", i), fmt.Sprintf("video %d", i)))
	}
	ts := newTestScanner(t, lib)
	ts.store.batch = 3

	ts.scan(t, Report{Added: 8})
	if got := len(ts.videos(t)); got != 8 {
		t.Fatalf("catalog has %d videos, want 8", got)
	}
	if got := len(ts.probeJobs(t)); got != 8 {
		t.Errorf("%d videos waiting to be read, want 8", got)
	}

	for _, name := range names {
		if err := os.Remove(name); err != nil {
			t.Fatal(err)
		}
	}
	ts.scan(t, Report{Unchanged: 1, Missing: 7})
	ts.clock = ts.clock.Add(ForgetAfter + time.Hour)
	ts.scan(t, Report{Unchanged: 1, Forgotten: 7})
	if got := ts.videos(t); len(got) != 1 || got["keep.mp4"].id == 0 {
		t.Errorf("catalog = %v, want only keep.mp4", got)
	}
}

// TestScanReadsADuplicateOnlyOnce: second copies are not in the catalog, so
// without memory every scan would read them again, every minute.
func TestScanReadsADuplicateOnlyOnce(t *testing.T) {
	lib := t.TempDir()
	writeFile(t, lib, "mare.mp4", "sea")
	// Files are taken in name order: this one goes in the catalog.
	original := writeFile(t, lib, "Copia/mare.mp4", "sea")
	ts := newTestScanner(t, lib)
	opened := 0
	ts.open = func(dir string) fs.FS { return countingFS{FS: os.DirFS(dir), opened: &opened} }

	ts.scan(t, Report{Added: 1, Duplicates: 1})
	opened = 0
	ts.scan(t, Report{Unchanged: 1, Duplicates: 1})
	if opened != 0 {
		t.Errorf("second scan opened %d files, want 0", opened)
	}

	// The original goes away: the copy takes its place, still without
	// being read again, and the video keeps its likes and comments.
	id := ts.videos(t)["Copia/mare.mp4"].id
	if err := os.Remove(original); err != nil {
		t.Fatal(err)
	}
	ts.scan(t, Report{Moved: 1})
	if v := ts.videos(t)["mare.mp4"]; v.id != id || v.missing {
		t.Errorf("copy = %+v, want video %d in its new place", v, id)
	}
	if opened != 0 {
		t.Errorf("opened %d files, want 0", opened)
	}
}

// TestScanWaitsForAFileBeingCopied: a film copied into the folder over the
// network changes at every scan. Taken each time, it would be read, probed
// and looked up on the internet again and again until the copy ends.
func TestScanWaitsForAFileBeingCopied(t *testing.T) {
	lib := t.TempDir()
	name := writeFile(t, lib, "film.mkv", "the beginning")
	info, err := os.Stat(name)
	if err != nil {
		t.Fatal(err)
	}
	ts := newTestScanner(t, lib)
	ts.clock = info.ModTime().Add(10 * time.Second)

	// Seen for the first time: taken at once, most files arrive whole.
	ts.scan(t, Report{Added: 1})
	id := ts.videos(t)["film.mkv"].id
	if _, err := ts.db.Exec(`UPDATE jobs SET state = 'done'`); err != nil {
		t.Fatal(err)
	}

	// It keeps growing: the scan leaves it alone and the video stays.
	grow := func(more string, at time.Time) {
		t.Helper()
		f, err := os.OpenFile(name, os.O_APPEND|os.O_WRONLY, 0)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.WriteString(more); err != nil {
			t.Fatal(err)
		}
		if err := f.Close(); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(name, at, at); err != nil {
			t.Fatal(err)
		}
	}
	for i := range 3 {
		ts.clock = ts.clock.Add(time.Minute)
		grow(fmt.Sprint(" and more ", i), ts.clock.Add(-5*time.Second))
		ts.scan(t, Report{Unchanged: 1})
		if v := ts.videos(t)["film.mkv"]; v.id != id || v.missing {
			t.Fatalf("while copying: %+v, want the same video, present", v)
		}
		if got := ts.probeJobs(t)["film.mkv"]; got != "done" {
			t.Fatalf("while copying the probe is %q, want left alone", got)
		}
	}

	// The copy is over: once the file has rested, it is read again.
	ts.clock = ts.clock.Add(settleTime)
	ts.scan(t, Report{Updated: 1})
	if got := ts.probeJobs(t)["film.mkv"]; got != "pending" {
		t.Errorf("after the copy the probe is %q, want pending", got)
	}
}

func TestStillCopying(t *testing.T) {
	now := int64(1_000) * int64(time.Second)
	recent := now - int64(30*time.Second)
	old := now - int64(settleTime) - 1
	file := func(size, mod int64) found { return found{loc: location{1, "a.mkv"}, size: size, modTime: mod} }
	tests := []struct {
		name       string
		f, before  found
		seenBefore bool
		knownHere  bool
		want       bool
	}{
		{"new file seen for the first time", file(10, recent), found{}, false, false, false},
		{"new file still growing", file(20, recent), file(10, recent-1), true, false, true},
		{"new file unchanged since last scan", file(10, recent), file(10, recent), true, false, false},
		{"known video being rewritten", file(20, recent), found{}, false, true, true},
		{"known video changed long ago", file(20, old), found{}, false, true, false},
		{"growing but quiet for long", file(20, old), file(10, old-1), true, false, false},
		{"date in the future", file(20, now+int64(time.Hour)), file(10, recent), true, true, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := stillCopying(tt.f, tt.before, tt.seenBefore, tt.knownHere, now); got != tt.want {
				t.Errorf("stillCopying = %v, want %v", got, tt.want)
			}
		})
	}
}

// TestScanRemakesTheCoverWhenAPictureChanges: a picture with the video's
// name, put next to it after the video arrived, replaced or taken away,
// becomes (or stops being) its cover without anyone pressing a button.
func TestScanRemakesTheCoverWhenAPictureChanges(t *testing.T) {
	lib := t.TempDir()
	writeFile(t, lib, "Viaggi/mare.mp4", "sea")
	writeFile(t, lib, "Viaggi/lago.mp4", "lake")
	writeFile(t, lib, "Viaggi/lago.jpg", "lake picture")
	ts := newTestScanner(t, lib)
	woken := 0
	ts.OnNewJobs(func() { woken++ })
	done := func() {
		t.Helper()
		if _, err := ts.db.Exec(`UPDATE jobs SET state = 'done'`); err != nil {
			t.Fatal(err)
		}
	}

	// A new video with a picture already there gets its cover from it.
	ts.scan(t, Report{Added: 2})
	if got := ts.jobs(t, "cover"); got["Viaggi/lago.mp4"] != "pending" || got["Viaggi/mare.mp4"] != "" {
		t.Fatalf("cover jobs after the first scan = %v, want only lago.mp4", got)
	}
	done()
	ts.scan(t, Report{Unchanged: 2})
	if got := ts.jobs(t, "cover"); got["Viaggi/lago.mp4"] != "done" {
		t.Fatalf("cover jobs after a scan that changed nothing = %v", got)
	}

	// A picture put there later.
	writeFile(t, lib, "Viaggi/Mare-Poster.PNG", "sea picture")
	ts.scan(t, Report{Unchanged: 2})
	if got := ts.jobs(t, "cover"); got["Viaggi/mare.mp4"] != "pending" || got["Viaggi/lago.mp4"] != "done" {
		t.Fatalf("cover jobs after adding a picture = %v, want mare.mp4 pending", got)
	}
	done()

	// A picture replaced.
	writeFile(t, lib, "Viaggi/lago.jpg", "another lake picture")
	ts.scan(t, Report{Unchanged: 2})
	if got := ts.jobs(t, "cover"); got["Viaggi/lago.mp4"] != "pending" || got["Viaggi/mare.mp4"] != "done" {
		t.Fatalf("cover jobs after replacing a picture = %v, want lago.mp4 pending", got)
	}
	done()

	// A picture taken away: back to a frame of the video.
	if err := os.Remove(filepath.Join(lib, "Viaggi", "Mare-Poster.PNG")); err != nil {
		t.Fatal(err)
	}
	ts.scan(t, Report{Unchanged: 2})
	if got := ts.jobs(t, "cover"); got["Viaggi/mare.mp4"] != "pending" {
		t.Fatalf("cover jobs after removing a picture = %v, want mare.mp4 pending", got)
	}
	if woken != 4 {
		t.Errorf("worker woken %d times, want 4", woken)
	}
}

// TestScanKeepsCoversWhenAFolderCannotBeRead: a folder that cannot be read
// shows no picture, and that must not take a cover away.
func TestScanKeepsCoversWhenAFolderCannotBeRead(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("needs Unix permissions and a normal user")
	}
	lib := t.TempDir()
	writeFile(t, lib, "mare.mp4", "sea")
	writeFile(t, lib, "mare.jpg", "sea picture")
	writeFile(t, lib, "Chiusa/altro.mp4", "other")
	ts := newTestScanner(t, lib)
	ts.scan(t, Report{Added: 2})
	if _, err := ts.db.Exec(`UPDATE jobs SET state = 'done'`); err != nil {
		t.Fatal(err)
	}

	if err := os.Remove(filepath.Join(lib, "mare.jpg")); err != nil {
		t.Fatal(err)
	}
	lockDir(t, filepath.Join(lib, "Chiusa"), 0o000)
	if _, err := ts.Scan(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := ts.jobs(t, "cover"); got["mare.mp4"] != "done" {
		t.Errorf("cover jobs with a folder unreadable = %v, want nothing asked", got)
	}
}

// pictures returns the category pictures in the catalog: path → pending.
func (ts *testScanner) pictures(t *testing.T) map[string]bool {
	t.Helper()
	rows, err := ts.db.Query(`SELECT path, pending FROM category_pictures`)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			t.Error(err)
		}
	}()
	out := map[string]bool{}
	for rows.Next() {
		var path string
		var pending bool
		if err := rows.Scan(&path, &pending); err != nil {
			t.Fatal(err)
		}
		out[path] = pending
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// TestScanFindsTheCategoryPictures: pictures like poster.jpg in the folder
// of a category are found, their copies asked for when new or changed, and
// forgotten when taken away.
func TestScanFindsTheCategoryPictures(t *testing.T) {
	lib := t.TempDir()
	writeFile(t, lib, "Viaggi/mare.mp4", "sea")
	writeFile(t, lib, "Viaggi/poster.jpg", "poster")
	writeFile(t, lib, "Viaggi/2025/fanart.jpg", "not the category's folder")
	writeFile(t, lib, "Corsi/lezione.mp4", "lesson")
	ts := newTestScanner(t, lib)
	asked, changed := 0, 0
	ts.OnCategoryPictures(func(context.Context) { asked++ })
	ts.OnChange(func() { changed++ })
	made := func() {
		t.Helper()
		if _, err := ts.db.Exec(`UPDATE category_pictures SET pending = 0`); err != nil {
			t.Fatal(err)
		}
	}

	ts.scan(t, Report{Added: 2})
	if got := ts.pictures(t); len(got) != 1 || !got["Viaggi/poster.jpg"] || asked != 1 {
		t.Fatalf("pictures = %v, copies asked %d times; want poster.jpg waiting, asked once", got, asked)
	}
	made()
	ts.scan(t, Report{Unchanged: 2})
	if asked != 1 {
		t.Errorf("copies asked %d times after a scan that changed nothing, want still 1", asked)
	}

	// A picture added to another category, and the poster replaced.
	writeFile(t, lib, "Corsi/Fanart.PNG", "fanart")
	writeFile(t, lib, "Viaggi/poster.jpg", "another poster")
	ts.scan(t, Report{Unchanged: 2})
	if got := ts.pictures(t); len(got) != 2 || !got["Corsi/Fanart.PNG"] || !got["Viaggi/poster.jpg"] || asked != 2 {
		t.Fatalf("pictures = %v, asked %d; want both waiting, asked twice", got, asked)
	}
	made()

	// The poster taken away: forgotten, and the pages are told.
	changedBefore := changed
	if err := os.Remove(filepath.Join(lib, "Viaggi", "poster.jpg")); err != nil {
		t.Fatal(err)
	}
	ts.scan(t, Report{Unchanged: 2})
	if got := ts.pictures(t); len(got) != 1 || got["Corsi/Fanart.PNG"] {
		t.Errorf("pictures = %v, want only Corsi's fanart, already made", got)
	}
	if changed != changedBefore+1 || asked != 2 {
		t.Errorf("pages told %d times (want %d), copies asked %d (want 2)", changed, changedBefore+1, asked)
	}
}
