//go:build unix

package database

import (
	"errors"
	"fmt"
	"os"
	"syscall"
)

// lockFile takes an exclusive lock on the file at path, without waiting.
func lockFile(path string) (*os.File, error) {
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		closeErr := f.Close()
		switch {
		case errors.Is(err, syscall.EWOULDBLOCK):
			return nil, errLocked
		case errors.Is(err, syscall.ENOTSUP), errors.Is(err, syscall.ENOLCK), errors.Is(err, syscall.EINVAL):
			return nil, errors.Join(errUnsupported, closeErr)
		}
		return nil, errors.Join(fmt.Errorf("flock: %w", err), closeErr)
	}
	return f, nil
}
