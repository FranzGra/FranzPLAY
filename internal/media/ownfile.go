package media

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
)

// SaveOwnFile writes a file chosen by the administrator (an uploaded
// cover or clip, a category image) in dir, a folder of the data folder,
// all or nothing (rule 6). The name is new each time, "<id>-<16 hex>" and
// ext, so a cached old one is never shown; it is returned.
func SaveOwnFile(dir string, id int64, ext string, body io.Reader) (name string, err error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", fmt.Errorf("create %s folder: %w", filepath.Base(dir), err)
	}
	random := make([]byte, 8)
	if _, err := rand.Read(random); err != nil {
		return "", fmt.Errorf("name uploaded file: %w", err)
	}
	name = strconv.FormatInt(id, 10) + "-" + hex.EncodeToString(random) + ext
	tmp, err := os.CreateTemp(dir, ".new-*")
	if err != nil {
		return "", fmt.Errorf("save uploaded file: %w", err)
	}
	defer func() {
		// Left over only when something failed; after success it was renamed.
		if rmErr := os.Remove(tmp.Name()); rmErr != nil && !errors.Is(rmErr, fs.ErrNotExist) {
			err = errors.Join(err, rmErr)
		}
	}()
	if _, err := io.Copy(tmp, body); err != nil {
		return "", errors.Join(fmt.Errorf("save uploaded file: %w", err), tmp.Close())
	}
	if err := tmp.Close(); err != nil {
		return "", fmt.Errorf("save uploaded file: %w", err)
	}
	if err := os.Rename(tmp.Name(), filepath.Join(dir, name)); err != nil {
		return "", fmt.Errorf("save uploaded file: %w", err)
	}
	return name, nil
}

// RemoveOwnFile deletes a file saved by SaveOwnFile. One already gone is
// fine.
func RemoveOwnFile(dir, name string) error {
	if err := os.Remove(filepath.Join(dir, filepath.Base(name))); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("remove uploaded file: %w", err)
	}
	return nil
}
