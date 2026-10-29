// Package safefile puts a finished file in its place so that it survives
// a power cut: rule 6, "all or nothing", also after the lights go out.
package safefile

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// Rename moves the finished temporary file from to its place to. Before,
// it makes the disk really write the file's content: without that, after
// a power cut the new name can point to an empty or cut file, while the
// job that made it is already marked done. After, it writes the folder
// too, so the new name itself is not lost.
func Rename(from, to string) error {
	if err := syncPath(from); err != nil {
		return fmt.Errorf("write %s to disk: %w", filepath.Base(from), err)
	}
	if err := os.Rename(from, to); err != nil {
		return err
	}
	// Windows cannot open a folder to write it: its renames are already
	// written by the system.
	if runtime.GOOS == "windows" {
		return nil
	}
	if err := syncPath(filepath.Dir(to)); err != nil {
		return fmt.Errorf("write folder of %s to disk: %w", filepath.Base(to), err)
	}
	return nil
}

func syncPath(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	return errors.Join(f.Sync(), f.Close())
}
