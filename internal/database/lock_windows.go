//go:build windows

package database

import (
	"errors"
	"os"
	"syscall"
)

// errSharingViolation is Windows' answer when the file is open elsewhere.
const errSharingViolation syscall.Errno = 32

// lockFile opens the file at path so that nobody else can open it until
// it is closed: Windows' own way of locking.
func lockFile(path string) (*os.File, error) {
	name, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	h, err := syscall.CreateFile(name, syscall.GENERIC_READ|syscall.GENERIC_WRITE,
		0, nil, syscall.OPEN_ALWAYS, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if errors.Is(err, errSharingViolation) {
		return nil, errLocked
	}
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(h), path), nil
}
