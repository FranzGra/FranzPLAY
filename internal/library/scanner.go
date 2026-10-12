package library

import (
	"context"
	"database/sql"
	"io/fs"
	"log/slog"
	"os"
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

// Scanner keeps the catalog in line with the video folders.
type Scanner struct {
	store     store
	libraries []string
	logger    *slog.Logger
	now       func() time.Time
	open      func(dir string) fs.FS
	newJobs   func()
}

// NewScanner returns a scanner for the given video folders.
func NewScanner(db *sql.DB, libraries []string, logger *slog.Logger) *Scanner {
	return &Scanner{
		store:     store{db: db},
		libraries: libraries,
		logger:    logger,
		now:       time.Now,
		open:      os.DirFS, // read-only view of the folder
		newJobs:   func() {},
	}
}

// OnNewJobs sets what to call when a scan adds work to the job queue,
// usually waking the job worker.
func (s *Scanner) OnNewJobs(f func()) { s.newJobs = f }

// Run scans once right away, then again at every interval, until ctx is
// cancelled. A failed scan is logged and retried at the next interval.
func (s *Scanner) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		start := time.Now()
		report, err := s.Scan(ctx)
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
		}
	}
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
		if l.complete() && !trusted[id] {
			s.logger.WarnContext(ctx, "video folder is empty but had videos: is the disk mounted? Nothing will be marked missing",
				"folder", dir, "videos", presentPerLibrary[id])
		}
		files = append(files, l.files...)
	}

	// 2. Read the fingerprint of the files that are new or changed.
	unchanged, toIdentify := compare(knownVideos, files)
	identifiedFiles := make([]identified, 0, len(toIdentify))
	for _, f := range toIdentify {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		fp, err := fingerprint(folders[f.loc.library], f.loc.path)
		if err != nil {
			report.Problems++
			trusted[f.loc.library] = false
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
		s.logger.InfoContext(ctx, "duplicate video ignored", "path", d.loc.path)
	}
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
	return report, nil
}
