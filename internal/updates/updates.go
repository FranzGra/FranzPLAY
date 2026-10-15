// Package updates tells the administrators when a newer FranzPLAY has been
// published. It only looks: it never downloads or installs anything.
//
// Once a day FranzPLAY asks GitHub for the latest official release of the
// project (drafts and pre-releases are not counted by GitHub itself) and
// compares it with the release it was built from. The administrator can
// turn the check off; then GitHub is never contacted.
package updates

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"sync"
	"time"
	"unicode/utf8"
)

// LatestURL is the only address FranzPLAY calls: the latest official
// release of the project on GitHub.
const LatestURL = "https://api.github.com/repos/FranzGra/FranzPLAY/releases/latest"

// The keys of the settings table.
const (
	keyCheck  = "updates.check"  // "on" or "off"; missing means on
	keyLatest = "updates.latest" // the last answer, as JSON
)

const (
	// Interval is how often GitHub is asked.
	Interval = 24 * time.Hour
	// firstDelay is the wait after starting, so the check does not slow down the start.
	firstDelay = time.Minute
	// maxJitter spreads the checks of many FranzPLAY a little.
	maxJitter = 30 * time.Second
	// requestTimeout is how long GitHub has to answer.
	requestTimeout = 10 * time.Second
	// maxNotes is how much of the release notes is kept.
	maxNotes = 2000
)

// Latest is what the last check found.
type Latest struct {
	CheckedAt time.Time `json:"checkedAt"`
	Version   string    `json:"version"` // "1.5.0"; "" when no release is published yet
	URL       string    `json:"url"`     // the release page on GitHub
	Notes     string    `json:"notes"`   // the start of the release notes
	ETag      string    `json:"etag"`    // lets GitHub answer "nothing changed"
}

// Checker asks GitHub, remembers the answer and says what to show.
type Checker struct {
	db      *sql.DB
	logger  *slog.Logger
	release string // "1.2.3", or "" for a development build
	commit  string
	url     string
	client  *http.Client

	now      func() time.Time
	after    func(time.Duration) <-chan time.Time
	jitter   func() time.Duration
	interval time.Duration
	first    time.Duration

	wake chan struct{}
	mu   sync.Mutex // one check at a time
}

// New makes the checker of this FranzPLAY. release is the version it was
// built from ("v1.2.3" or "1.2.3", "" when built from a commit); commit is
// the name of the commit.
func New(db *sql.DB, release, commit string, logger *slog.Logger) *Checker {
	return &Checker{
		db:       db,
		logger:   logger,
		release:  CleanRelease(release),
		commit:   commit,
		url:      LatestURL,
		client:   &http.Client{Timeout: requestTimeout},
		now:      time.Now,
		after:    time.After,
		jitter:   func() time.Duration { return rand.N(maxJitter) },
		interval: Interval,
		first:    firstDelay,
		wake:     make(chan struct{}, 1),
	}
}

// Enabled says whether the administrator lets FranzPLAY check. On unless turned off.
func (c *Checker) Enabled(ctx context.Context) (bool, error) {
	var value string
	err := c.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, keyCheck).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return true, nil
	}
	if err != nil {
		return false, fmt.Errorf("read update setting: %w", err)
	}
	return value != "off", nil
}

// SetEnabled turns the check on or off. Turning it on checks soon, if the
// last check is old.
func (c *Checker) SetEnabled(ctx context.Context, on bool) error {
	value := "off"
	if on {
		value = "on"
	}
	if err := c.setSetting(ctx, keyCheck, value); err != nil {
		return fmt.Errorf("save update setting: %w", err)
	}
	if on {
		select {
		case c.wake <- struct{}{}:
		default:
		}
	}
	return nil
}

func (c *Checker) setSetting(ctx context.Context, key, value string) error {
	_, err := c.db.ExecContext(ctx, `
		INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT (key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

// last reads what the last check found; zero if there was none.
func (c *Checker) last(ctx context.Context) (Latest, error) {
	var value string
	err := c.db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, keyLatest).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return Latest{}, nil
	}
	if err != nil {
		return Latest{}, fmt.Errorf("read last update check: %w", err)
	}
	return decodeLatest(value), nil
}

// decodeLatest reads a saved check; a broken one reads as never checked.
func decodeLatest(value string) Latest {
	var l Latest
	if json.Unmarshal([]byte(value), &l) != nil {
		return Latest{}
	}
	return l
}

func (c *Checker) saveLast(ctx context.Context, l Latest) error {
	data, err := json.Marshal(l)
	if err != nil {
		return err
	}
	if err := c.setSetting(ctx, keyLatest, string(data)); err != nil {
		return fmt.Errorf("save update check: %w", err)
	}
	return nil
}

// Run checks once a day until ctx ends: the first time shortly after the
// start, or when a day has passed since the check before a restart.
func (c *Checker) Run(ctx context.Context) {
	delay := c.first + c.jitter()
	if l, err := c.last(ctx); err == nil && !l.CheckedAt.IsZero() {
		if wait := l.CheckedAt.Add(c.interval).Sub(c.now()); wait > delay {
			delay = wait
		}
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.after(delay):
			c.checkIfEnabled(ctx)
			delay = c.interval
		case <-c.wake:
			// Just turned on: check now only if the last check is old.
			l, err := c.last(ctx)
			if err == nil && !l.CheckedAt.IsZero() && c.now().Sub(l.CheckedAt) < c.interval {
				continue
			}
			c.checkIfEnabled(ctx)
			delay = c.interval
		}
	}
}

func (c *Checker) checkIfEnabled(ctx context.Context) {
	on, err := c.Enabled(ctx)
	if err != nil {
		c.logger.WarnContext(ctx, "update check skipped", "error", err)
		return
	}
	if !on {
		return
	}
	if err := c.Check(ctx); err != nil {
		// No network, GitHub busy…: tried again tomorrow, nobody is bothered.
		c.logger.WarnContext(ctx, "update check failed", "error", err)
	}
}

// release is the part of GitHub's answer FranzPLAY reads.
type release struct {
	TagName    string `json:"tag_name"`
	HTMLURL    string `json:"html_url"`
	Body       string `json:"body"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
}

// Check asks GitHub once and remembers the answer.
func (c *Checker) Check(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	prev, err := c.last(ctx)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "FranzPLAY/"+c.installed())
	if prev.ETag != "" {
		req.Header.Set("If-None-Match", prev.ETag)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("ask GitHub: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	now := c.now().UTC()
	switch resp.StatusCode {
	case http.StatusNotModified:
		prev.CheckedAt = now
		return c.saveLast(ctx, prev)
	case http.StatusNotFound:
		// No official release published yet: normal for a new project.
		c.logger.InfoContext(ctx, "update check: no release published yet")
		return c.saveLast(ctx, Latest{CheckedAt: now})
	case http.StatusOK:
	default:
		return fmt.Errorf("ask GitHub: answer %s", resp.Status)
	}
	var r release
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&r); err != nil {
		return fmt.Errorf("read GitHub's answer: %w", err)
	}
	if r.Draft || r.Prerelease {
		return errors.New("GitHub's latest release is not an official one")
	}
	version := CleanRelease(r.TagName)
	if version == "" {
		return fmt.Errorf("GitHub's latest release has no version: %q", r.TagName)
	}
	l := Latest{CheckedAt: now, Version: version, URL: r.HTMLURL, Notes: cut(r.Body, maxNotes),
		ETag: resp.Header.Get("ETag")}
	if err := c.saveLast(ctx, l); err != nil {
		return err
	}
	c.logger.InfoContext(ctx, "update check done", "installed", c.installed(), "latest", version,
		"newer", Newer(c.release, version))
	return nil
}

// installed is the release, or the commit for a development build.
func (c *Checker) installed() string {
	if c.release != "" {
		return c.release
	}
	return c.commit
}

// cut keeps at most n characters of s, without breaking one in half.
func cut(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n]) + "…"
}

// Status is what the administrator sees.
type Status struct {
	Enabled bool   `json:"enabled"`
	Release string `json:"release"` // "" for a development build
	Commit  string `json:"commit"`
	// Development: built from a commit, not from a release. It is never
	// told to update, because it cannot be compared with a release.
	Development bool       `json:"development"`
	CheckedAt   *time.Time `json:"checkedAt"` // nil when never checked
	Latest      string     `json:"latest"`    // "" when none is known
	URL         string     `json:"url"`
	Notes       string     `json:"notes"`
	Newer       bool       `json:"newer"` // Latest is newer than Release
}

// Status reads what to show. With the check off, nothing found is shown.
func (c *Checker) Status(ctx context.Context) (Status, error) {
	on, err := c.Enabled(ctx)
	if err != nil {
		return Status{}, err
	}
	s := Status{Enabled: on, Release: c.release, Commit: c.commit, Development: c.release == ""}
	if !on {
		return s, nil
	}
	l, err := c.last(ctx)
	if err != nil {
		return Status{}, err
	}
	if !l.CheckedAt.IsZero() {
		t := l.CheckedAt
		s.CheckedAt = &t
	}
	s.Latest, s.URL, s.Notes = l.Version, l.URL, l.Notes
	s.Newer = Newer(c.release, l.Version)
	return s, nil
}
