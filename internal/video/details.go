package video

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// Details are what a file next to the video says about it: its real
// title, a description, who made it and when. Empty fields are not known.
type Details struct {
	Title       string
	Description string
	Author      string // the channel or the person who published it
	Date        string // when it was published or filmed, as "2006-01-02"
}

// Sizes kept from a details file: the database refuses longer ones.
const (
	MaxDetailsTitle  = 200
	MaxDescription   = 5000
	MaxDetailsAuthor = 100
)

// InfoJSONSuffix ends the name of the file yt-dlp writes next to a video
// with --write-info-json: "mare [abc123].mp4" has "mare [abc123].info.json".
const InfoJSONSuffix = ".info.json"

// MaxInfoJSONSize is the biggest details file read. yt-dlp's files list
// every format of the video and weigh up to a few megabytes; a bigger
// file is not one of them.
const MaxInfoJSONSize = 16 << 20

// infoJSON are the fields of yt-dlp's file FranzPLAY uses.
type infoJSON struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Channel     string `json:"channel"`
	Uploader    string `json:"uploader"`
	UploadDate  string `json:"upload_date"` // "20190315"
}

// ParseInfoJSON reads the file yt-dlp writes next to a video. What comes
// from the file is checked here, once: text is cleaned and cut, a date
// that is not a real one is dropped.
func ParseInfoJSON(data []byte) (Details, error) {
	var in infoJSON
	if err := json.Unmarshal(data, &in); err != nil {
		return Details{}, fmt.Errorf("%w: %w", ErrBadDetails, err)
	}
	author := in.Channel
	if strings.TrimSpace(author) == "" {
		author = in.Uploader
	}
	return Details{
		Title:       cut(oneLine(in.Title), MaxDetailsTitle),
		Description: cleanDescription(in.Description),
		Author:      cut(oneLine(author), MaxDetailsAuthor),
		Date:        compactDate(in.UploadDate),
	}, nil
}

// ErrBadDetails means a details file is not what it should be.
var ErrBadDetails = errors.New("details file not readable")

// oneLine makes text from a file safe to show on one line: valid, without
// control characters, with single spaces.
func oneLine(s string) string {
	if !utf8.ValidString(s) {
		return ""
	}
	return strings.Join(strings.FieldsFunc(s, func(r rune) bool {
		return unicode.IsSpace(r) || unicode.IsControl(r)
	}), " ")
}

// cleanDescription keeps the lines of a description, without control
// characters, spaces at the ends of lines, or more than one empty line
// in a row.
func cleanDescription(s string) string {
	if !utf8.ValidString(s) {
		return ""
	}
	var lines []string
	empty := 0
	for line := range strings.SplitSeq(strings.ReplaceAll(s, "\r\n", "\n"), "\n") {
		line = strings.TrimRightFunc(strings.Map(func(r rune) rune {
			if r == '\t' {
				return ' '
			}
			if unicode.IsControl(r) {
				return -1
			}
			return r
		}, line), unicode.IsSpace)
		if line == "" {
			empty++
			if empty > 1 || len(lines) == 0 {
				continue
			}
		} else {
			empty = 0
		}
		lines = append(lines, line)
	}
	return cut(strings.TrimSpace(strings.Join(lines, "\n")), MaxDescription)
}

// cut keeps at most n characters of s.
func cut(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return strings.TrimSpace(string([]rune(s)[:n]))
}

// compactDate turns yt-dlp's "20190315" into "2019-03-15"; anything that
// is not a real day between 1900 and 2100 becomes "".
func compactDate(s string) string {
	t, err := time.Parse("20060102", s)
	if err != nil || !sensibleYear(t) {
		return ""
	}
	return t.Format(time.DateOnly)
}

// sensibleYear says if a day from a file is between 1900 and 2100:
// anything else is a mistake in the file.
func sensibleYear(t time.Time) bool {
	return t.Year() >= 1900 && t.Year() <= 2100
}
