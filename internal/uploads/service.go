package uploads

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/library"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// Folders inside the data folder.
const (
	// FolderName holds the finished uploads, one folder per person. The
	// scanner reads it like a video folder.
	FolderName = "uploads"
	// incomingName holds the files still arriving, named <id>.part.
	incomingName = "incoming"
)

// Folder returns the absolute path of the uploads folder in dataDir: the
// same string for the scanner and for this package, since it names the
// folder in the libraries table.
func Folder(dataDir string) (string, error) {
	abs, err := filepath.Abs(filepath.Join(dataDir, FolderName))
	if err != nil {
		return "", fmt.Errorf("uploads folder: %w", err)
	}
	return abs, nil
}

// Service receives the uploads.
type Service struct {
	store    store
	folder   string // finished uploads (absolute)
	incoming string // files still arriving
	logger   *slog.Logger
	now      func() time.Time
	// account returns the logged-in person: users.FromContext, replaced
	// only in tests.
	account func(context.Context) (users.Account, bool)
	// changed is called when the catalog has a new video, or one of the
	// uploaded videos changed: usually it wakes the job worker and tells
	// the open pages.
	changed func()

	mu   sync.Mutex
	busy map[int64]bool // uploads receiving a piece right now
}

// NewService returns the uploads service for the data folder, creating
// its folders when needed.
func NewService(db *sql.DB, dataDir string, logger *slog.Logger) (*Service, error) {
	folder, err := Folder(dataDir)
	if err != nil {
		return nil, err
	}
	incoming := filepath.Join(dataDir, incomingName)
	for _, dir := range []string{folder, incoming} {
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return nil, fmt.Errorf("create folder %q: %w", dir, err)
		}
	}
	return &Service{
		store: store{db: db}, folder: folder, incoming: incoming, logger: logger,
		now: time.Now, account: users.FromContext, changed: func() {}, busy: map[int64]bool{},
	}, nil
}

// OnChange sets what to call when an upload becomes a video, or an
// uploaded video changes.
func (s *Service) OnChange(f func()) { s.changed = f }

// partName is the file of an upload still arriving, inside incoming/.
func partName(id int64) string { return strconv.FormatInt(id, 10) + ".part" }

// start begins an upload for a person and creates its empty file.
func (s *Service) start(ctx context.Context, a users.Account, req newUpload) (upload, error) {
	u, err := s.store.start(ctx, a.ID, a.UploadQuota, s.now(), func(sp Space, waiting int) (newUpload, error) {
		return check(a, req, sp, waiting)
	})
	if err != nil {
		return upload{}, err
	}
	f, err := os.OpenFile(filepath.Join(s.incoming, partName(u.ID)), os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o640)
	if err == nil {
		err = f.Close()
	}
	if err != nil {
		return upload{}, errors.Join(fmt.Errorf("create upload file: %w", err), s.store.remove(ctx, u.ID))
	}
	return u, nil
}

// hold marks an upload as receiving a piece. It returns false when another
// request already does: two pieces must never be written at the same time.
func (s *Service) hold(id int64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.busy[id] {
		return false
	}
	s.busy[id] = true
	return true
}

func (s *Service) release(id int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.busy, id)
}

// receive adds a piece of length bytes, starting at offset, to an upload of
// the person. When it is the last piece, the upload becomes a video.
func (s *Service) receive(ctx context.Context, user, id, offset, length int64, body io.Reader) (upload, error) {
	if !s.hold(id) {
		return upload{}, errBusy
	}
	defer s.release(id)

	u, err := s.store.get(ctx, user, id)
	if err != nil {
		return upload{}, err
	}
	if err := fits(u.Size, u.Received, offset, length); err != nil {
		return upload{}, err
	}
	if length > 0 {
		if err := s.write(id, offset, length, body); err != nil {
			return upload{}, err
		}
		u.Received += length
		if err := s.store.arrived(ctx, id, u.Received, s.now()); err != nil {
			return upload{}, err
		}
	}
	if u.Received < u.Size {
		return u, nil
	}
	video, err := s.finish(ctx, u)
	if err != nil {
		return upload{}, err
	}
	u.Video = video
	s.changed()
	return u, nil
}

// write puts a piece at offset in the upload's file and makes sure it is
// on the disk before the database says it arrived. Anything after offset
// is dropped first: a piece cut by a dropped connection was never counted.
func (s *Service) write(id, offset, length int64, body io.Reader) (err error) {
	f, err := os.OpenFile(filepath.Join(s.incoming, partName(id)), os.O_WRONLY, 0)
	if err != nil {
		return fmt.Errorf("open upload %d: %w", id, err)
	}
	defer func() {
		if closeErr := f.Close(); closeErr != nil {
			err = errors.Join(err, fmt.Errorf("close upload %d: %w", id, closeErr))
		}
	}()
	if err := f.Truncate(offset); err != nil {
		return fmt.Errorf("prepare upload %d: %w", id, err)
	}
	if _, err := f.Seek(offset, io.SeekStart); err != nil {
		return fmt.Errorf("prepare upload %d: %w", id, err)
	}
	n, err := io.Copy(f, io.LimitReader(body, length))
	if err != nil {
		return fmt.Errorf("receive upload %d: %w", id, err)
	}
	if n != length {
		return fmt.Errorf("receive upload %d: %d of %d bytes: %w", id, n, length, io.ErrUnexpectedEOF)
	}
	if err := f.Sync(); err != nil {
		return fmt.Errorf("save upload %d: %w", id, err)
	}
	return nil
}

// finish moves a complete file to the uploads folder and adds it to the
// catalog. A video that is already on FranzPLAY is refused and its file
// removed.
func (s *Service) finish(ctx context.Context, u upload) (int64, error) {
	part := filepath.Join(s.incoming, partName(u.ID))
	fp, err := library.Fingerprint(os.DirFS(s.incoming), partName(u.ID))
	if err != nil {
		return 0, err
	}
	rel := destination(u.user, u.ID, u.Name)
	dst := filepath.Join(s.folder, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(dst), 0o750); err != nil {
		return 0, fmt.Errorf("create folder for upload %d: %w", u.ID, err)
	}
	// Never replace a video: if a file is already there, something is wrong.
	if _, err := os.Lstat(dst); err == nil {
		return 0, fmt.Errorf("place upload %d: %s already exists", u.ID, dst)
	} else if !errors.Is(err, os.ErrNotExist) {
		return 0, fmt.Errorf("place upload %d: %w", u.ID, err)
	}
	info, err := os.Stat(part)
	if err != nil {
		return 0, fmt.Errorf("read upload %d: %w", u.ID, err)
	}
	placed := false
	id, err := s.store.finish(ctx, finished{
		upload: u, fingerprint: fp, library: s.folder, path: rel, modTime: info.ModTime().UnixNano(),
	}, s.now(), func() error {
		// Renaming is one step: the scanner sees the whole file or nothing
		// (rule 6). It keeps the date the scanner compares with.
		if err := os.Rename(part, dst); err != nil {
			return fmt.Errorf("place upload %d: %w", u.ID, err)
		}
		placed = true
		return nil
	})
	if errors.Is(err, errDuplicate) {
		if cleanErr := errors.Join(s.store.remove(ctx, u.ID), removeFile(part)); cleanErr != nil {
			return 0, errors.Join(err, cleanErr)
		}
		return 0, err
	}
	if err != nil && placed {
		// The catalog was not saved: the file goes back to wait.
		return 0, errors.Join(err, os.Rename(dst, part))
	}
	return id, err
}

// cancel stops an upload of the person and removes its file.
func (s *Service) cancel(ctx context.Context, user, id int64) error {
	if !s.hold(id) {
		return errBusy
	}
	defer s.release(id)
	if _, err := s.store.get(ctx, user, id); err != nil {
		return err
	}
	return s.drop(ctx, id)
}

// drop forgets an upload and removes its file.
func (s *Service) drop(ctx context.Context, id int64) error {
	if err := s.store.remove(ctx, id); err != nil {
		return err
	}
	return removeFile(filepath.Join(s.incoming, partName(id)))
}

// Clean removes the uploads that received nothing for ForgetAfter, and the
// files in incoming/ that belong to no upload (left by a person who was
// removed, or by a stop at the wrong moment). It returns how many files
// it removed.
func (s *Service) Clean(ctx context.Context) (int, error) {
	removed := 0
	stale, err := s.store.stale(ctx, s.now().Add(-ForgetAfter))
	if err != nil {
		return 0, err
	}
	for _, id := range stale {
		if !s.hold(id) {
			continue // a piece is arriving right now: not forgotten after all
		}
		err := s.drop(ctx, id)
		s.release(id)
		if err != nil {
			return removed, err
		}
		removed++
	}

	// The files are listed before the uploads are read: an upload always
	// has its row before its file, so a file listed here whose upload is
	// not found really belongs to nobody.
	entries, err := os.ReadDir(s.incoming)
	if err != nil {
		return removed, fmt.Errorf("read %s: %w", s.incoming, err)
	}
	known, err := s.store.ids(ctx)
	if err != nil {
		return removed, err
	}
	for _, e := range entries {
		if !e.Type().IsRegular() {
			continue
		}
		id, err := strconv.ParseInt(strings.TrimSuffix(e.Name(), ".part"), 10, 64)
		if err == nil && known[id] {
			continue
		}
		if err := removeFile(filepath.Join(s.incoming, e.Name())); err != nil {
			return removed, err
		}
		removed++
	}
	return removed, nil
}

// removeFile removes a file of the data folder; one already gone is fine.
func removeFile(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove %s: %w", path, err)
	}
	return nil
}
