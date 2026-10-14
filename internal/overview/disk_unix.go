//go:build unix

package overview

import (
	"fmt"

	"golang.org/x/sys/unix"
)

// diskSpace reads the size of the disk that holds dir, and how much is free.
func diskSpace(dir string) (total, free uint64, err error) {
	var st unix.Statfs_t
	if err := unix.Statfs(dir, &st); err != nil {
		return 0, 0, fmt.Errorf("disk space of %q: %w", dir, err)
	}
	block := uint64(st.Bsize) //nolint:gosec // a block size is never negative
	return st.Blocks * block, st.Bavail * block, nil
}
