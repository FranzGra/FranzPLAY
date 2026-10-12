// Package catalog answers the interface's questions about the videos:
// the list, one video, the categories, and the video file itself.
package catalog

import (
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// Page sizes for the video list.
const (
	defaultLimit = 60
	maxLimit     = 200
)

// errBadQuery means the address had parameters FranzPLAY cannot use.
var errBadQuery = errors.New("bad query")

// listQuery is what the interface asks of the video list, already checked.
type listQuery struct {
	category string // "" = all
	limit    int
	offset   int
}

// parseListQuery checks the parameters of GET /api/videos once, here.
// Accepted: category, limit (1 to 200), offset (0 or more).
func parseListQuery(values url.Values) (listQuery, error) {
	q := listQuery{category: strings.TrimSpace(values.Get("category")), limit: defaultLimit}
	if s := values.Get("limit"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > maxLimit {
			return listQuery{}, fmt.Errorf("%w: limit must be a number from 1 to %d", errBadQuery, maxLimit)
		}
		q.limit = n
	}
	if s := values.Get("offset"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 0 {
			return listQuery{}, fmt.Errorf("%w: offset must be a number from 0", errBadQuery)
		}
		q.offset = n
	}
	return q, nil
}

// parseID checks a video id taken from the address.
func parseID(s string) (int64, bool) {
	id, err := strconv.ParseInt(s, 10, 64)
	return id, err == nil && id > 0
}

// validCoverName reports whether name looks like a cover FranzPLAY made
// ("12-0a1b2c3d.jpg"). Anything else, such as "../franzplay.db", is refused
// before the disk is touched.
func validCoverName(name string) bool {
	id, rest, ok := strings.Cut(name, "-")
	if !ok || !strings.HasSuffix(rest, ".jpg") {
		return false
	}
	if _, ok := parseID(id); !ok {
		return false
	}
	hex := strings.TrimSuffix(rest, ".jpg")
	if hex == "" || len(hex) > 8 {
		return false
	}
	for _, c := range hex {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

// contentTypes are the types sent with the video file, by extension.
var contentTypes = map[string]string{
	".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime",
	".webm": "video/webm", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
	".wmv": "video/x-ms-wmv", ".flv": "video/x-flv", ".ts": "video/mp2t",
	".m2ts": "video/mp2t", ".mts": "video/mp2t", ".mpg": "video/mpeg",
	".mpeg": "video/mpeg", ".3gp": "video/3gpp", ".ogv": "video/ogg",
}

// contentType returns the type of a video file, or a generic one.
func contentType(ext string) string {
	if t, ok := contentTypes[strings.ToLower(ext)]; ok {
		return t
	}
	return "application/octet-stream"
}
