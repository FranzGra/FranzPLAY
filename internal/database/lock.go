package database

import (
	"errors"
	"fmt"
	"path/filepath"
)

// LockName is the file that says a FranzPLAY is using the data folder.
const LockName = "franzplay.lock"

// ErrInUse means another FranzPLAY is already using the data folder.
var ErrInUse = errors.New("another FranzPLAY is already using this data folder")

// ErrNoLock means the folder's disk cannot lock files (some network or
// shared folders). Lock then still returns an unlock that does nothing:
// FranzPLAY starts anyway, it only cannot notice a second copy.
var ErrNoLock = errors.New("the data folder cannot be locked")

// Lock makes sure only one FranzPLAY at a time uses dataDir: two would
// both run the job queue and clean each other's unfinished files. The
// system lets the lock go by itself when the program ends, even if it is
// killed, so a stale lock file never blocks the next start. The caller
// must call unlock when done.
func Lock(dataDir string) (unlock func() error, err error) {
	path := filepath.Join(dataDir, LockName)
	f, err := lockFile(path)
	if errors.Is(err, errLocked) {
		return nil, fmt.Errorf("%w (%s)", ErrInUse, dataDir)
	}
	if errors.Is(err, errUnsupported) {
		return func() error { return nil }, fmt.Errorf("%w (%s)", ErrNoLock, dataDir)
	}
	if err != nil {
		return nil, fmt.Errorf("lock data folder: %w", err)
	}
	return func() error {
		if err := f.Close(); err != nil {
			return fmt.Errorf("unlock data folder: %w", err)
		}
		return nil
	}, nil
}

// What lockFile returns when someone else holds the lock, or when the
// disk cannot lock at all.
var (
	errLocked      = errors.New("locked")
	errUnsupported = errors.New("locks not supported")
)
