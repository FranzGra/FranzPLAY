package library

import (
	"context"
	"database/sql"
	"io/fs"
	"log/slog"
	"os"
	"sync"
	"time"
)

// ForgetAfter is how long a missing video stays in the catalog, with its
// likes and comments, before FranzPLAY forgets it. A disk unplugged for a
// few days must not wipe anything.
const ForgetAfter = 30 * 24 * time.Hour

// Report counts what one scan did.
type Report struct {
	Unchanged  int // found where they were
	Added      int // new videos
	Moved      int // renamed or moved
	Updated    int // same place, file changed
	Restored   int // missing videos that came back
	Missing    int // no longer found
	Duplicates int // extra copies of a video, ignored
	Forgotten  int // missing for longer than ForgetAfter, removed from the catalog
	Problems   int // folders or files that could not be read
}

// Changed reports whether the scan changed the list of videos people see.
func (r Report) Changed() bool {
	return r.Added+r.Moved+r.Updated+r.Restored+r.Missing+r.Forgotten > 0
}

// Scanner keeps the catalog in line with the video folders.
type Scanner struct {
	store     store
	libraries []string
	logger    *slog.Logger
	now       func() time.Time
	open      func(dir string) fs.FS
	newJobs   func()
	changed   func()
	scanning  func(bool)
	asked     chan struct{} // a scan asked for by the administrator

	mu     sync.Mutex
	status Status

	// What the previous scan learned about files that are not in the
	// catalog, so the next scan does not read them again. Only Scan uses
	// them, and only Run calls Scan, so they need no lock.
	pending map[location]found    // new or changed files, to notice one still being copied
	skipped map[location]skipFile // duplicates and unreadable files
}

// skipFile is a file the catalog does not hold: a second copy of a video,
// or a file that could not be read. While its size and date stay the same,
// the next scans reuse what was learned instead of reading it again (an
// archive with thousands of copies would otherwise be read every minute,
// and the disk would never rest).
type skipFile struct {
	found
	fingerprint string // empty when the file could not be read
	readAt      int64  // when it was read, Unix nanoseconds
}

// retryUnreadable is how long an unreadable file is left alone before the
// scan tries again: the reason (a disk error, its permissions) may be gone
// without the file itself changing.
const retryUnreadable = time.Hour

// NewScanner returns a scanner for the given video folders.
func NewScanner(db *sql.DB, libraries []string, logger *slog.Logger) *Scanner {
	return &Scanner{
		store:     store{db: db},
		libraries: libraries,
		logger:    logger,
		now:       time.Now,
		open:      os.DirFS, // read-only view of the folder
		newJobs:   func() {},
		changed:   func() {},
		scanning:  func(bool) {},
		asked:     make(chan struct{}, 1),
		status:    Status{Folders: map[string]FolderState{}},
	}
}

// OnNewJobs sets what to call when a scan adds work to the job queue,
// usually waking the job worker.
func (s *Scanner) OnNewJobs(f func()) { s.newJobs = f }

// OnChange sets what to call when a scan changes the list of videos,
// usually telling the open pages.
func (s *Scanner) OnChange(f func()) { s.changed = f }

// OnScanning sets what to call when a scan starts (true) and ends
// (false), so the administrator's page can follow it.
func (s *Scanner) OnScanning(f func(bool)) { s.scanning = f }

// ScanNow asks Run for a scan as soon as possible, without waiting for
// the interval. It never blocks: asking twice before the scan starts
// gives one scan.
func (s *Scanner) ScanNow() {
	select {
	case s.asked <- struct{}{}:
	default:
	}
}

// Status returns what the scanner is doing and how the last scan went.
func (s *Scanner) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.status
	st.Folders = make(map[string]FolderState, len(s.status.Folders))
	for k, v := range s.status.Folders {
		st.Folders[k] = v
	}
	return st
}

// Run scans once right away, then again at every interval, until ctx is
// cancelled. A failed scan is logged and retried at the next interval.
func (s *Scanner) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		start := time.Now()
		s.setScanning(true)
		report, err := s.Scan(ctx)
		took := time.Since(start)
		s.mu.Lock()
		s.status.Scanning = false
		s.status.Last = &ScanResult{At: start, Took: took, Report: report}
		if err != nil {
			s.status.Last.Err = err.Error()
		}
		s.mu.Unlock()
		s.scanning(false)
		switch {
		case ctx.Err() != nil:
			return
		case err != nil:
			s.logger.ErrorContext(ctx, "library scan failed", "error", err)
		default:
			s.logger.InfoContext(ctx, "library scan finished",
				"duration", time.Since(start).Round(time.Millisecond),
				"unchanged", report.Unchanged, "added", report.Added, "moved", report.Moved,
				"updated", report.Updated, "restored", report.Restored, "missing", report.Missing,
				"duplicates", report.Duplicates, "forgotten", report.Forgotten, "problems", report.Problems)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-s.asked:
			ticker.Reset(interval)
		}
	}
}

func (s *Scanner) setScanning(on bool) {
	s.mu.Lock()
	s.status.Scanning = on
	s.mu.Unlock()
	s.scanning(on)
}

// Scan compares the video folders with the catalog once and saves the result.
func (s *Scanner) Scan(ctx context.Context) (Report, error) {
	var report Report
	ids, err := s.store.libraryIDs(ctx, s.libraries)
	if err != nil {
		return report, err
	}
	knownVideos, err := s.store.knownVideos(ctx)
	if err != nil {
		return report, err
	}
	presentPerLibrary := make(map[int64]int)
	for _, k := range knownVideos {
		if !k.missing {
			presentPerLibrary[k.loc.library]++
		}
	}

	// 1. List every library.
	folderStates := make(map[string]FolderState, len(s.libraries))
	defer func() {
		s.mu.Lock()
		s.status.Folders = folderStates
		s.mu.Unlock()
	}()
	folders := make(map[int64]fs.FS, len(ids))
	trusted := make(map[int64]bool, len(ids))
	var files []found
	for _, dir := range s.libraries {
		id := ids[dir]
		folders[id] = s.open(dir)
		l := list(folders[id], id)
		if !l.complete() {
			report.Problems += len(l.problems)
			s.logger.WarnContext(ctx, "video folder not read completely, no video in it will be marked missing",
				"folder", dir, "error", l.err())
		}
		trusted[id] = libraryTrusted(l.complete(), len(l.files), presentPerLibrary[id])
		var state FolderState
		if !l.complete() {
			state.Problem = l.problems[0].Error()
		}
		if l.complete() && !trusted[id] {
			state.LooksUnplugged = true
			s.logger.WarnContext(ctx, "video folder is empty but had videos: is the disk mounted? Nothing will be marked missing",
				"folder", dir, "videos", presentPerLibrary[id])
		}
		folderStates[dir] = state
		files = append(files, l.files...)
	}

	// 2. Read the fingerprint of the files that are new or changed.
	unchanged, toIdentify := compare(knownVideos, files)
	presentAt := make(map[location]int64, len(knownVideos))
	for _, k := range knownVideos {
		if !k.missing {
			presentAt[k.loc] = k.id
		}
	}
	scanStart := s.now().UnixNano()
	pending := make(map[location]found, len(toIdentify))
	skipped := make(map[location]skipFile)
	identifiedFiles := make([]identified, 0, len(toIdentify))
	for _, f := range toIdentify {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		pending[f.loc] = f
		knownID, knownHere := presentAt[f.loc]
		before, seenBefore := s.pending[f.loc]
		if stillCopying(f, before, seenBefore, knownHere, scanStart) {
			// Still being written: look again at the next scan. A known
			// video keeps its place meanwhile, and is not marked missing.
			if knownHere {
				unchanged = append(unchanged, knownID)
			}
			continue
		}
		if old, ok := s.skipped[f.loc]; ok && old.found == f &&
			(old.fingerprint != "" || scanStart-old.readAt < int64(retryUnreadable)) {
			skipped[f.loc] = old
			if old.fingerprint == "" {
				// Still unreadable: said already, and still no reason to
				// trust this folder to mark videos missing.
				report.Problems++
				trusted[f.loc.library] = false
				continue
			}
			identifiedFiles = append(identifiedFiles, identified{found: f, fingerprint: old.fingerprint})
			continue
		}
		fp, err := Fingerprint(folders[f.loc.library], f.loc.path)
		if err != nil {
			report.Problems++
			trusted[f.loc.library] = false
			skipped[f.loc] = skipFile{found: f, readAt: scanStart}
			s.logger.WarnContext(ctx, "cannot read video", "path", f.loc.path, "error", err)
			continue
		}
		identifiedFiles = append(identifiedFiles, identified{found: f, fingerprint: fp})
	}

	// 3. Decide and save.
	ch := reconcile(knownVideos, unchanged, identifiedFiles, func(library int64) bool {
		ok, configured := trusted[library]
		// A library removed from the settings: its videos are missing.
		return ok || !configured
	})
	now := s.now()
	if err := s.store.apply(ctx, ch, now); err != nil {
		return report, err
	}
	if len(ch.added) > 0 || len(ch.updates) > 0 {
		s.newJobs()
	}
	forgotten, err := s.store.forget(ctx, now.Add(-ForgetAfter))
	if err != nil {
		return report, err
	}

	for _, d := range ch.duplicates {
		if _, known := s.skipped[d.loc]; !known {
			s.logger.InfoContext(ctx, "duplicate video ignored", "path", d.loc.path)
		}
		skipped[d.loc] = skipFile{found: d.found, fingerprint: d.fingerprint}
	}
	// Remembered only now that the scan is saved: a scan that failed
	// halfway will look at everything again.
	s.pending, s.skipped = pending, skipped
	report.Unchanged = len(ch.unchanged)
	report.Added = len(ch.added)
	report.Missing = len(ch.gone)
	report.Duplicates = len(ch.duplicates)
	report.Forgotten = int(forgotten)
	for _, u := range ch.updates {
		switch {
		case u.wasMissing:
			report.Restored++
		case u.kind == moved:
			report.Moved++
		default:
			report.Updated++
		}
	}
	if report.Changed() {
		s.changed()
	}
	return report, nil
}
