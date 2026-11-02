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

	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/safefile"
)

// SaveOwnFile writes a file chosen by the administrator (an uploaded
// cover or clip, a category image) in dir, a folder of the content folder,
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
	if err := safefile.Rename(tmp.Name(), filepath.Join(dir, name)); err != nil {
		return "", fmt.Errorf("save uploaded file: %w", err)
	}
	return name, nil
}

// SaveChosenFile writes a file chosen by the administrator in the folder of a
// video, all or nothing (rule 6), under its fixed name. A version new each
// time goes in what it returns, what the database saves: the file on the disk
// keeps its name, and a cached old one is never shown.
func SaveChosenFile(root content.Root, code, file string, body io.Reader) (stored string, err error) {
	random := make([]byte, 8)
	if _, err := rand.Read(random); err != nil {
		return "", fmt.Errorf("name uploaded file: %w", err)
	}
	dir, err := root.MakeWork()
	if err != nil {
		return "", err
	}
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
	if err := root.Put(code, file, tmp.Name()); err != nil {
		return "", fmt.Errorf("save uploaded file: %w", err)
	}
	return content.Stored(code, file, hex.EncodeToString(random)), nil
}

// RemoveOwnFile deletes a file saved by SaveOwnFile. One already gone is
// fine.
func RemoveOwnFile(dir, name string) error {
	if err := os.Remove(filepath.Join(dir, filepath.Base(name))); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("remove uploaded file: %w", err)
	}
	return nil
}
