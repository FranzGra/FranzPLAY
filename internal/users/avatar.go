package users

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png" // photos may also arrive as PNG
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/respond"
)

// avatarDir is the folder of profile photos, inside the data folder.
const avatarDir = "avatars"

// The limits of a profile photo. The interface crops it square and small
// before sending it; these only stop what a browser would never send.
const (
	maxAvatarBytes = 4 << 20
	minAvatarSide  = 64
	maxAvatarSide  = 1024
	avatarQuality  = 85
)

// errBadAvatar means a profile photo cannot be used.
var errBadAvatar = fmt.Errorf("the photo must be a square JPEG or PNG picture, from %d to %d pixels a side",
	minAvatarSide, maxAvatarSide)

// checkAvatar decides whether a picture, from its header alone, can be a
// profile photo: before decoding it, so a huge picture never fills memory.
func checkAvatar(c image.Config, format string) error {
	if format != "jpeg" && format != "png" {
		return errBadAvatar
	}
	if c.Width != c.Height || c.Width < minAvatarSide || c.Width > maxAvatarSide {
		return errBadAvatar
	}
	return nil
}

// avatarFile is the path of a user's photo.
func (s *Service) avatarFile(id int64) string {
	return filepath.Join(s.dataDir, avatarDir, strconv.FormatInt(id, 10)+".jpg")
}

// setAvatar checks a picture and keeps it as the user's photo. It is
// decoded and saved again as JPEG, so what is kept is only the picture:
// nothing else the file might carry (hidden data, where it was taken).
func (s *Service) setAvatar(ctx context.Context, a Account, data []byte) (Account, error) {
	c, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return Account{}, errBadAvatar
	}
	if err := checkAvatar(c, format); err != nil {
		return Account{}, err
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return Account{}, errBadAvatar
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: avatarQuality}); err != nil {
		return Account{}, fmt.Errorf("encode photo: %w", err)
	}
	if err := writeAtomically(filepath.Dir(s.avatarFile(a.ID)), filepath.Base(s.avatarFile(a.ID)), out.Bytes()); err != nil {
		return Account{}, fmt.Errorf("save photo: %w", err)
	}
	version := s.now().UnixMilli()
	res, err := s.store.db.ExecContext(ctx, `UPDATE users SET avatar = ? WHERE id = ?`, version, a.ID)
	if err != nil {
		return Account{}, fmt.Errorf("save photo: %w", err)
	}
	if err := oneRow(res, "save photo"); err != nil {
		return Account{}, err
	}
	a.Avatar = version
	return a, nil
}

// removeAvatar takes away a user's photo: their initial shows again.
func (s *Service) removeAvatar(ctx context.Context, a Account) (Account, error) {
	res, err := s.store.db.ExecContext(ctx, `UPDATE users SET avatar = 0 WHERE id = ?`, a.ID)
	if err != nil {
		return Account{}, fmt.Errorf("remove photo: %w", err)
	}
	if err := oneRow(res, "remove photo"); err != nil {
		return Account{}, err
	}
	if err := s.removeAvatarFile(a.ID); err != nil {
		return Account{}, err
	}
	a.Avatar = 0
	return a, nil
}

// removeAvatarFile deletes a photo file; one already gone is fine.
func (s *Service) removeAvatarFile(id int64) error {
	if err := os.Remove(s.avatarFile(id)); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("remove photo: %w", err)
	}
	return nil
}

// forgetAvatar deletes the photo of an account that no longer exists. The
// account is gone either way, so a file that cannot be deleted is written
// in the log for the administrator, not answered as a failure.
func (s *Service) forgetAvatar(ctx context.Context, id int64) {
	if err := s.removeAvatarFile(id); err != nil {
		s.logger.ErrorContext(ctx, "photo of a deleted account left in the data folder", "id", id, "err", err)
	}
}

// writeAtomically writes a file of the data folder all or nothing (rule 6):
// a temporary file, renamed only once complete.
func writeAtomically(dir, name string, data []byte) (err error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".new-*")
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, os.Remove(tmp.Name()))
		}
	}()
	if _, err := tmp.Write(data); err != nil {
		return errors.Join(err, tmp.Close())
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), filepath.Join(dir, name))
}

func (s *Service) handleSetAvatar(w http.ResponseWriter, r *http.Request) {
	a, ok := FromContext(r.Context())
	if !ok {
		respond.Error(w, r, s.logger, http.StatusUnauthorized, "login required")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxAvatarBytes))
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		respond.Error(w, r, s.logger, http.StatusRequestEntityTooLarge, "the photo is too big")
		return
	}
	if err != nil {
		respond.Error(w, r, s.logger, http.StatusBadRequest, "the photo did not arrive whole")
		return
	}
	a, err = s.setAvatar(r.Context(), a, data)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.logger.InfoContext(r.Context(), "profile photo changed", "id", a.ID)
	respond.JSON(w, r, s.logger, http.StatusOK, a)
}

func (s *Service) handleRemoveAvatar(w http.ResponseWriter, r *http.Request) {
	a, ok := FromContext(r.Context())
	if !ok {
		respond.Error(w, r, s.logger, http.StatusUnauthorized, "login required")
		return
	}
	a, err := s.removeAvatar(r.Context(), a)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	respond.JSON(w, r, s.logger, http.StatusOK, a)
}

// handleAvatar sends a user's photo to anyone logged in: it shows on their
// channel and next to their comments. Its address carries the photo's
// version, so browsers may keep it for good.
func (s *Service) handleAvatar(w http.ResponseWriter, r *http.Request) {
	id, ok := s.userID(w, r)
	if !ok {
		return
	}
	f, err := os.Open(s.avatarFile(id))
	if errors.Is(err, fs.ErrNotExist) {
		respond.Error(w, r, s.logger, http.StatusNotFound, "no photo")
		return
	}
	if err != nil {
		respond.InternalError(w, r, s.logger, fmt.Errorf("open photo: %w", err))
		return
	}
	defer func() {
		if err := f.Close(); err != nil {
			s.logger.WarnContext(r.Context(), "close photo", "id", id, "err", err)
		}
	}()
	info, err := f.Stat()
	if err != nil {
		respond.InternalError(w, r, s.logger, fmt.Errorf("open photo: %w", err))
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(w, r, "", info.ModTime(), f)
}

// ImportAvatar makes img the profile photo of a user who has none, for the
// import from the old FranzPLAY. img must be square and from 64 to 1024
// pixels a side, like a photo sent by the interface. It reports false,
// changing nothing, when the user already has a photo.
func ImportAvatar(ctx context.Context, db *sql.DB, dataDir string, id int64, img image.Image, now time.Time) (bool, error) {
	b := img.Bounds()
	if err := checkAvatar(image.Config{Width: b.Dx(), Height: b.Dy()}, "jpeg"); err != nil {
		return false, err
	}
	var version int64
	if err := db.QueryRowContext(ctx, `SELECT avatar FROM users WHERE id = ?`, id).Scan(&version); err != nil {
		return false, fmt.Errorf("import photo of user %d: %w", id, err)
	}
	if version != 0 {
		return false, nil
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: avatarQuality}); err != nil {
		return false, fmt.Errorf("encode photo: %w", err)
	}
	if err := writeAtomically(filepath.Join(dataDir, avatarDir), strconv.FormatInt(id, 10)+".jpg", out.Bytes()); err != nil {
		return false, fmt.Errorf("save photo: %w", err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE users SET avatar = ? WHERE id = ?`, now.UnixMilli(), id); err != nil {
		return false, fmt.Errorf("save photo: %w", err)
	}
	return true, nil
}
