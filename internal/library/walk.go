package library

import (
	"errors"
	"fmt"
	"io/fs"
	"path"
	"strings"

	"github.com/FranzGra/FranzPLAY/internal/video"
)

// listing is what reading one library produced.
type listing struct {
	files []found
	// images are the pictures in each folder ("." for the library itself),
	// which may be the cover of a video next to them.
	images map[string][]picture
	// problems are folders or files that could not be read. When there is
	// any, the listing is incomplete and no video of this library may be
	// marked missing.
	problems []error
}

// list finds every video file in a library. It goes through an fs.FS,
// which can only read: listing a library can never change it.
//
// Hidden folders and the ones NAS systems create for themselves are skipped.
// Symbolic links are skipped too, so a link cannot make the same video
// appear twice or lead outside the library.
func list(fsys fs.FS, library int64) listing {
	var l listing
	err := fs.WalkDir(fsys, ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil {
			if name == "." {
				return err // the library itself cannot be read: stop here
			}
			l.problems = append(l.problems, err)
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if name != "." && skipDir(d.Name()) {
				return fs.SkipDir
			}
			return nil
		}
		if !d.Type().IsRegular() {
			return nil
		}
		if video.IsImage(d.Name()) {
			if info, err := d.Info(); err == nil {
				if l.images == nil {
					l.images = make(map[string][]picture)
				}
				dir := path.Dir(name)
				l.images[dir] = append(l.images[dir], picture{
					name: d.Name(), size: info.Size(), modTime: info.ModTime().UnixNano()})
			}
			// A picture that vanished meanwhile is simply not there.
			return nil
		}
		if !IsVideo(d.Name()) {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			// The file vanished or cannot be read while we were looking.
			l.problems = append(l.problems, fmt.Errorf("read %s: %w", name, err))
			return nil
		}
		l.files = append(l.files, found{
			loc:     location{library: library, path: name},
			size:    info.Size(),
			modTime: info.ModTime().UnixNano(),
		})
		return nil
	})
	if err != nil {
		l.problems = append(l.problems, fmt.Errorf("read library: %w", err))
	}
	return l
}

// picture is an image file seen on disk by this scan.
type picture struct {
	name    string // the file name alone
	size    int64
	modTime int64 // Unix nanoseconds
}

// coverImages says, for every video of the listing, the version of the
// picture next to it that becomes its cover (video.CoverImage), or ""
// when there is none.
func (l listing) coverImages() map[string]string {
	covers := make(map[string]string, len(l.files))
	// The names and versions of each folder's pictures, worked out once
	// per folder: a folder may hold thousands of videos and pictures.
	type folder struct {
		names    []string
		versions map[string]string
	}
	folders := make(map[string]folder, len(l.images))
	for dir, pictures := range l.images {
		fo := folder{names: make([]string, len(pictures)), versions: make(map[string]string, len(pictures))}
		for i, p := range pictures {
			fo.names[i] = p.name
			fo.versions[p.name] = video.ImageVersion(p.name, p.size, p.modTime)
		}
		folders[dir] = fo
	}
	for _, f := range l.files {
		fo := folders[path.Dir(f.loc.path)]
		name, _ := video.CoverImage(path.Base(f.loc.path), fo.names)
		covers[f.loc.path] = fo.versions[name] // "" when there is none
	}
	return covers
}

// categoryPictures are the pictures in the folders of the categories (the
// first-level folders) whose name says they are the picture of the
// category, like "Viaggi/poster.jpg" (video.IsCategoryPicture).
func (l listing) categoryPictures() []categoryPicture {
	var out []categoryPicture
	for dir, pictures := range l.images {
		if dir == "." || strings.Contains(dir, "/") {
			continue
		}
		for _, p := range pictures {
			if video.IsCategoryPicture(p.name) {
				out = append(out, categoryPicture{path: dir + "/" + p.name, category: dir, size: p.size, modTime: p.modTime})
			}
		}
	}
	return out
}

// categoryPicture is a picture of a category seen on disk by this scan.
type categoryPicture struct {
	path     string // inside the library, with "/"
	category string
	size     int64
	modTime  int64 // Unix nanoseconds
}

// complete reports whether the listing read every folder without problems.
func (l listing) complete() bool { return len(l.problems) == 0 }

// err joins the problems into one error, or nil when there were none.
func (l listing) err() error { return errors.Join(l.problems...) }
