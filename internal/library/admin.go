package library

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// Status is what the scanner is doing and how its last scan went.
type Status struct {
	Scanning bool
	Last     *ScanResult // nil before the first scan ends
	Folders  map[string]FolderState
}

// ScanResult is the outcome of one scan.
type ScanResult struct {
	At     time.Time
	Took   time.Duration
	Report Report
	Err    string // "" when the scan worked
}

// FolderState is how one video folder looked at the last scan.
type FolderState struct {
	Problem        string // the first thing that could not be read, "" if none
	LooksUnplugged bool   // empty but had videos: nothing was marked missing
}

// Routes adds the video folders' API for administrators to mux:
//
//	GET  /api/library       the folders, their videos and the last scan
//	POST /api/library/scan  check the folders now
func (s *Scanner) Routes(interval time.Duration, logger *slog.Logger) func(mux *http.ServeMux) {
	a := admin{scanner: s, interval: interval, logger: logger, account: users.FromContext}
	return a.routes
}

type admin struct {
	scanner  *Scanner
	interval time.Duration
	logger   *slog.Logger
	account  func(context.Context) (users.Account, bool)
}

func (a admin) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/library", a.only(a.handleOverview))
	mux.HandleFunc("POST /api/library/scan", a.only(a.handleScan))
}

// only lets only administrators through.
func (a admin) only(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		who, ok := a.account(r.Context())
		switch {
		case !ok:
			respond.Error(w, r, a.logger, http.StatusUnauthorized, "login required")
		case who.Role != users.Admin:
			respond.Error(w, r, a.logger, http.StatusForbidden, "administrators only")
		default:
			next(w, r)
		}
	}
}

// overview is the answer of GET /api/library.
type overview struct {
	Scanning bool        `json:"scanning"`
	Interval int         `json:"interval"` // seconds between two automatic scans
	LastScan *lastScan   `json:"lastScan"`
	Folders  []folderRow `json:"folders"`
}

type lastScan struct {
	At         time.Time `json:"at"`
	Seconds    float64   `json:"seconds"`
	Error      string    `json:"error"`
	Unchanged  int       `json:"unchanged"`
	Added      int       `json:"added"`
	Moved      int       `json:"moved"`
	Updated    int       `json:"updated"`
	Restored   int       `json:"restored"`
	Missing    int       `json:"missing"`
	Duplicates int       `json:"duplicates"`
	Forgotten  int       `json:"forgotten"`
	Problems   int       `json:"problems"`
}

type folderRow struct {
	Path           string `json:"path"`
	Videos         int    `json:"videos"`  // present
	Missing        int    `json:"missing"` // not found, kept for a while
	Problem        string `json:"problem"`
	LooksUnplugged bool   `json:"looksUnplugged"`
}

func (a admin) handleOverview(w http.ResponseWriter, r *http.Request) {
	st := a.scanner.Status()
	o := overview{Scanning: st.Scanning, Interval: int(a.interval.Seconds()), Folders: []folderRow{}}
	if l := st.Last; l != nil {
		rep := l.Report
		o.LastScan = &lastScan{
			At: l.At.UTC(), Seconds: l.Took.Seconds(), Error: l.Err,
			Unchanged: rep.Unchanged, Added: rep.Added, Moved: rep.Moved, Updated: rep.Updated,
			Restored: rep.Restored, Missing: rep.Missing, Duplicates: rep.Duplicates,
			Forgotten: rep.Forgotten, Problems: rep.Problems,
		}
	}
	counts, err := a.scanner.store.counts(r.Context())
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	for _, dir := range a.scanner.libraries {
		c := counts[dir]
		f := st.Folders[dir]
		o.Folders = append(o.Folders, folderRow{
			Path: dir, Videos: c.present, Missing: c.missing,
			Problem: f.Problem, LooksUnplugged: f.LooksUnplugged,
		})
	}
	respond.JSON(w, r, a.logger, http.StatusOK, o)
}

func (a admin) handleScan(w http.ResponseWriter, r *http.Request) {
	a.scanner.ScanNow()
	who, _ := a.account(r.Context())
	a.logger.InfoContext(r.Context(), "library scan asked", "by", who.Name)
	w.WriteHeader(http.StatusAccepted)
}

type folderCount struct{ present, missing int }

// counts returns how many videos each library has, by folder path.
func (s store) counts(ctx context.Context) (_ map[string]folderCount, err error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT l.path,
			count(v.id) FILTER (WHERE v.missing_since IS NULL),
			count(v.id) FILTER (WHERE v.missing_since IS NOT NULL)
		FROM libraries l LEFT JOIN videos v ON v.library_id = l.id
		GROUP BY l.id`)
	if err != nil {
		return nil, fmt.Errorf("count videos per folder: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := map[string]folderCount{}
	for rows.Next() {
		var path string
		var c folderCount
		if err := rows.Scan(&path, &c.present, &c.missing); err != nil {
			return nil, fmt.Errorf("count videos per folder: %w", err)
		}
		out[path] = c
	}
	return out, rows.Err()
}
