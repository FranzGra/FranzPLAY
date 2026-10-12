package library

import (
	"errors"
	"fmt"
	"io/fs"
)

// listing is what reading one library produced.
type listing struct {
	files []found
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
		if !d.Type().IsRegular() || !IsVideo(d.Name()) {
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

// complete reports whether the listing read every folder without problems.
func (l listing) complete() bool { return len(l.problems) == 0 }

// err joins the problems into one error, or nil when there were none.
func (l listing) err() error { return errors.Join(l.problems...) }
