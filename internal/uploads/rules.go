// Package uploads lets the people the administrator chose upload videos
// from the browser.
//
// A video arrives in pieces: if the connection drops, the browser asks how
// much arrived and goes on from there, so a big file never starts over and
// never has to fit in memory. The file grows in the data folder's incoming/
// folder; when the last piece arrives it moves, in one step, to the data
// folder's uploads/ folder, one folder per person. The video folders are
// never touched (rule 1).
package uploads

import (
	"errors"
	"fmt"
	"path"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/FranzGra/FranzPLAY/internal/library"
	"github.com/FranzGra/FranzPLAY/internal/sharing"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// This file is the pure core: decisions about names, sizes and space.
// No disk, no database, no clock.

const (
	// MaxPiece is the largest piece of a file one request may carry. Pieces
	// go straight to the disk, so their size does not weigh on memory: it
	// only decides how much is sent again after a dropped connection.
	MaxPiece = 16 << 20 // 16 MiB

	// maxWaiting is how many unfinished uploads a person may have at once.
	maxWaiting = 5

	// ForgetAfter is how long an unfinished upload waits for its next piece
	// before FranzPLAY removes it and frees its space.
	ForgetAfter = 7 * 24 * time.Hour

	maxName  = 255 // characters of a file name
	maxTitle = 200 // characters of a title, as in the catalog
)

// Errors people can fix themselves.
var (
	errNotAllowed = errors.New("you cannot upload videos: the administrator decides who can")
	errNotVideo   = errors.New("this file is not a video FranzPLAY can show")
	errBadName    = errors.New("the file name must have from 1 to 255 characters, without control characters")
	errBadTitle   = errors.New("the title must have at most 200 characters, without control characters")
	errBadSize    = errors.New("the file is empty")
	errTooMany    = errors.New("finish or cancel your other uploads first")
	errNoSpace    = errors.New("not enough space left for your videos")
	errNotFound   = errors.New("upload not found")
	errWrongPlace = errors.New("this piece does not start where the upload is: ask how much arrived")
	errBigPiece   = errors.New("this piece is too big")
	errNoLength   = errors.New("the size of the piece is missing")
	errBusy       = errors.New("another piece of this upload is arriving")
	errDuplicate  = errors.New("this video is already on FranzPLAY")
)

// Space is how a person's quota is used, in bytes.
type Space struct {
	Quota    int64 `json:"quota"`    // what the administrator gave
	Used     int64 `json:"used"`     // the person's uploaded videos
	Reserved int64 `json:"reserved"` // the full size of the unfinished uploads
}

// Free is what is left for a new upload.
func (s Space) Free() int64 { return max(0, s.Quota-s.Used-s.Reserved) }

// newUpload is what a person asks to upload.
type newUpload struct {
	Name  string `json:"name"`  // the file name on their computer
	Title string `json:"title"` // "" = from the file name
	Size  int64  `json:"size"`  // bytes
	// Private: only the person who uploads it will see the video, and the
	// people in SharedWith, by id.
	Private    bool    `json:"private"`
	SharedWith []int64 `json:"sharedWith"`
}

// check decides whether a person may start an upload, given their space
// (without this upload) and how many uploads they have not finished. It
// returns the upload with a clean name and title.
func check(a users.Account, req newUpload, space Space, waiting int) (newUpload, error) {
	if !a.CanUpload {
		return newUpload{}, errNotAllowed
	}
	// Only the name of the file counts, never a folder it came from.
	name := strings.TrimSpace(path.Base(strings.ReplaceAll(req.Name, `\`, "/")))
	if !cleanText(name, maxName) || name == "." || name == "/" {
		return newUpload{}, errBadName
	}
	if !library.IsVideo(name) {
		return newUpload{}, errNotVideo
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = strings.TrimSpace(strings.TrimSuffix(name, path.Ext(name)))
	}
	if !cleanText(title, maxTitle) {
		return newUpload{}, errBadTitle
	}
	switch {
	case req.Size <= 0:
		return newUpload{}, errBadSize
	case waiting >= maxWaiting:
		return newUpload{}, errTooMany
	case req.Size > space.Free():
		return newUpload{}, errNoSpace
	}
	if len(req.SharedWith) > 0 && !req.Private {
		return newUpload{}, sharing.ErrNotPrivate
	}
	people, err := sharing.Clean(req.SharedWith, a.ID)
	if err != nil {
		return newUpload{}, err
	}
	if len(people) == 0 {
		people = nil
	}
	return newUpload{Name: name, Title: title, Size: req.Size, Private: req.Private, SharedWith: people}, nil
}

// cleanText reports whether s is valid text of 1 to most characters,
// without control characters such as new lines.
func cleanText(s string, most int) bool {
	n := utf8.RuneCountInString(s)
	if n == 0 || n > most || !utf8.ValidString(s) {
		return false
	}
	return !strings.ContainsFunc(s, unicode.IsControl)
}

// fits decides whether a piece of length bytes, starting at offset, may be
// added to an upload of size bytes of which received have arrived. A piece
// must start exactly where the upload is, so nothing is ever written twice
// or skipped.
func fits(size, received, offset, length int64) error {
	switch {
	case length < 0:
		return errNoLength
	case offset != received:
		return errWrongPlace
	case length == 0 && received < size:
		return errNoLength
	case length > MaxPiece || length > size-received:
		return errBigPiece
	}
	return nil
}

// destination is where a finished upload goes inside uploads/: one folder
// per person, and a name that cannot clash or contain anything strange.
func destination(user, upload int64, name string) string {
	return fmt.Sprintf("%d/%d%s", user, upload, strings.ToLower(path.Ext(name)))
}
