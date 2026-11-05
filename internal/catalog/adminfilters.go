package catalog

import (
	"fmt"
	"net/url"
	"strings"
	"time"
)

// The administrator's own filters on the list of videos, on top of the
// pills (show) and the search: by category, where the video comes from,
// subtitles, cover and previews, length and when it was added. They only
// read what the catalog already knows.

// Limits on the categories asked at once.
const (
	maxAdminCategories   = 50
	maxAdminCategoryName = 1000 // bytes: a path of folders, not a name typed by hand
)

// The lengths of the length filter, in seconds.
const (
	shortUpTo  = 5 * 60  // short: under 5 minutes
	mediumUpTo = 30 * 60 // medium: from 5 to 30 minutes; long: over 30
)

// adminNarrow is what the administrator's filters keep; the zero value
// keeps every video.
type adminNarrow struct {
	// categories as the videos have them, "Serie A/Stagione 1"; "" is the
	// videos with no category. Exactly these: a folder is not its subfolders.
	categories []string
	source     string // "folder", "upload"; "" = both
	subtitles  string // "with", "without"; "" = either
	missingArt string // "cover", "preview": the videos without it
	length     string // "short", "medium", "long"
	since      int64  // added at or after this Unix second; 0 = any time
}

// oneOf reads a parameter that may be missing or one of allowed.
func oneOf(values url.Values, key string, allowed ...string) (string, error) {
	v := values.Get(key)
	if v == "" {
		return "", nil
	}
	for _, a := range allowed {
		if v == a {
			return v, nil
		}
	}
	return "", fmt.Errorf("%w: %s must be %s", errBadQuery, key, strings.Join(allowed, " or "))
}

// parseAdminNarrow checks the filters of GET /api/admin/videos: category
// (repeated; empty for the videos with none), source=folder|upload,
// subtitles=with|without, missing=cover|preview, length=short|medium|long,
// added=7|30 (days before now).
func parseAdminNarrow(values url.Values, now time.Time) (adminNarrow, error) {
	var n adminNarrow
	cats := values["category"]
	if len(cats) > maxAdminCategories {
		return adminNarrow{}, fmt.Errorf("%w: at most %d categories", errBadQuery, maxAdminCategories)
	}
	seen := map[string]bool{}
	for _, c := range cats {
		if len(c) > maxAdminCategoryName {
			return adminNarrow{}, fmt.Errorf("%w: category too long", errBadQuery)
		}
		if !seen[c] {
			seen[c] = true
			n.categories = append(n.categories, c)
		}
	}
	var err error
	if n.source, err = oneOf(values, "source", "folder", "upload"); err != nil {
		return adminNarrow{}, err
	}
	if n.subtitles, err = oneOf(values, "subtitles", "with", "without"); err != nil {
		return adminNarrow{}, err
	}
	if n.missingArt, err = oneOf(values, "missing", "cover", "preview"); err != nil {
		return adminNarrow{}, err
	}
	if n.length, err = oneOf(values, "length", "short", "medium", "long"); err != nil {
		return adminNarrow{}, err
	}
	switch added, err := oneOf(values, "added", "7", "30"); {
	case err != nil:
		return adminNarrow{}, err
	case added == "7":
		n.since = now.AddDate(0, 0, -7).Unix()
	case added == "30":
		n.since = now.AddDate(0, 0, -30).Unix()
	}
	return n, nil
}

// hasSubtitles is the videos with a subtitle FranzPLAY knows: inside the
// file, or made by whisper (or imported) from its current content. The
// files next to the video are not in the catalog: they are read when
// the video plays.
const hasSubtitles = `(EXISTS (SELECT 1 FROM video_subtitles s WHERE s.video_id = v.id) OR
	EXISTS (SELECT 1 FROM auto_subtitles a WHERE a.video_id = v.id AND a.fingerprint = v.fingerprint))`

// where returns the conditions of the filters, each starting with " AND ",
// and their arguments.
func (n adminNarrow) where() (string, []any) {
	var sb strings.Builder
	var args []any
	if len(n.categories) > 0 {
		// v.category, not the name people see: no work for every video,
		// and two folders shown with the same name stay apart.
		sb.WriteString(` AND v.category IN (?` + strings.Repeat(`, ?`, len(n.categories)-1) + `)`)
		for _, c := range n.categories {
			args = append(args, c)
		}
	}
	switch n.source {
	case "folder":
		sb.WriteString(` AND v.uploaded_by IS NULL`)
	case "upload":
		sb.WriteString(` AND v.uploaded_by IS NOT NULL`)
	}
	switch n.subtitles {
	case "with":
		sb.WriteString(` AND ` + hasSubtitles)
	case "without":
		sb.WriteString(` AND NOT ` + hasSubtitles)
	}
	switch n.missingArt {
	case "cover":
		sb.WriteString(` AND v.cover IS NULL`)
	case "preview":
		sb.WriteString(` AND v.preview IS NULL`)
	}
	// A video not read yet has no length: it is in none of the three.
	switch n.length {
	case "short":
		sb.WriteString(` AND v.duration < ?`)
		args = append(args, shortUpTo)
	case "medium":
		sb.WriteString(` AND v.duration >= ? AND v.duration <= ?`)
		args = append(args, shortUpTo, mediumUpTo)
	case "long":
		sb.WriteString(` AND v.duration > ?`)
		args = append(args, mediumUpTo)
	}
	if n.since != 0 {
		sb.WriteString(` AND v.added_at >= ?`)
		args = append(args, n.since)
	}
	return sb.String(), args
}

// adminSearch is the administrator's search: every word in the title, in
// the category people see or in the path of the file. The category is
// matched as the home search does (categoryLike), not by working out the
// name people see for every video.
func adminSearch(words []string) (string, []any) {
	var sb strings.Builder
	var args []any
	for _, w := range words {
		sb.WriteString(` AND (v.shown_title LIKE ? ESCAPE '\' OR ` + categoryLike + ` OR v.path LIKE ? ESCAPE '\')`)
		p := likePattern(w)
		args = append(args, p, p, p, p)
	}
	return sb.String(), args
}
