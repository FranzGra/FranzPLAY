//go:build windows

package overview

import (
	"fmt"

	"golang.org/x/sys/windows"
)

// FreeSpace says how much is free on the disk that holds dir.
func FreeSpace(dir string) (uint64, error) {
	_, free, err := diskSpace(dir)
	return free, err
}

// diskSpace reads the size of the disk that holds dir, and how much is free.
func diskSpace(dir string) (total, free uint64, err error) {
	path, err := windows.UTF16PtrFromString(dir)
	if err != nil {
		return 0, 0, fmt.Errorf("disk space of %q: %w", dir, err)
	}
	if err := windows.GetDiskFreeSpaceEx(path, &free, &total, nil); err != nil {
		return 0, 0, fmt.Errorf("disk space of %q: %w", dir, err)
	}
	return total, free, nil
}
