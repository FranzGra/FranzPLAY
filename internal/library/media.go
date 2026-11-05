// Package library finds the videos in the video folders and keeps the
// catalog in the database up to date.
//
// Video folders are read-only for FranzPLAY: this package only lists
// folders and reads files, it never creates, renames or deletes anything
// there. A video is recognised by its content (its fingerprint), so moving
// or renaming a file keeps its likes, comments and history.
package library

import (
	"path"
	"strings"

	"github.com/FranzGra/FranzPLAY/internal/titles"
)

// videoExtensions are the file types treated as videos (lower case).
var videoExtensions = map[string]bool{
	".3g2": true, ".3gp": true, ".asf": true, ".avi": true, ".divx": true,
	".dv": true, ".f4v": true, ".flv": true, ".m2ts": true, ".m4v": true,
	".mkv": true, ".mov": true, ".mp4": true, ".mpeg": true, ".mpg": true,
	".mts": true, ".mxf": true, ".ogm": true, ".ogv": true, ".rm": true,
	".rmvb": true, ".ts": true, ".webm": true, ".wmv": true,
}

// ignoredDirs are folders that NAS systems and operating systems create
// for themselves. They never contain the user's videos.
var ignoredDirs = map[string]bool{
	"@eadir":                    true, // Synology thumbnails
	"#recycle":                  true, // Synology and QNAP recycle bin
	"@recycle":                  true, // QNAP recycle bin
	"$recycle.bin":              true, // Windows recycle bin
	"system volume information": true, // Windows
	"lost+found":                true, // Linux
}

// IsVideo reports whether a file name looks like a video FranzPLAY should show.
// Hidden files (starting with ".") are skipped: on macOS "._name.mp4" files
// are metadata, not videos.
func IsVideo(name string) bool {
	if strings.HasPrefix(name, ".") {
		return false
	}
	return videoExtensions[strings.ToLower(path.Ext(name))]
}

// skipDir reports whether a folder should not be explored.
func skipDir(name string) bool {
	return strings.HasPrefix(name, ".") || ignoredDirs[strings.ToLower(name)]
}

// titleOf turns "Viaggi/Sardegna 2025.mp4" into "Sardegna 2025", before
// the administrator's rules (package titles). relPath always uses "/" as
// separator.
func titleOf(relPath string) string { return titles.FileTitle(relPath) }

// categoryOf returns the folder that holds the video, inside the library:
// every folder with videos of its own is a category, at any depth, and its
// path is what tells it apart from another folder with the same name.
// "Viaggi/2025/mare.mp4" belongs to "Viaggi/2025"; a folder holding only
// other folders is no category. A video directly in the library has no
// category (""). The name people see is the last folder (categoryNames).
func categoryOf(relPath string) string {
	dir := path.Dir(relPath)
	if dir == "." {
		return ""
	}
	return dir
}
