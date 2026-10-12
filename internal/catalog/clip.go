package catalog

import (
	"bufio"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/respond"
)

// The administrator can choose the clip that plays on a video's card: a
// short video of their own, none at all, or the one FranzPLAY makes from
// the video. Like an uploaded cover, an uploaded video is kept in the data
// folder (rule 1) and the clip job makes the clip from it.

// maxOwnClip is the largest video accepted for a clip. Only its first
// seconds are used, so a short video is all it takes.
const maxOwnClip = 100 << 20

// ownClipTypes are the videos accepted, with the extension they are kept
// with.
var ownClipTypes = map[string]string{
	"video/mp4":  ".mp4",
	"video/webm": ".webm",
}

// Errors shown to people.
var (
	errNotAClip     = errors.New("the clip must be an MP4 or WebM video")
	errClipTooLarge = errors.New("the video is too large: at most 100 MB")
)

func (a admin) handleOwnClip(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		respond.Error(w, r, a.logger, http.StatusNotFound, errNotFound.Error())
		return
	}
	// The video is written to disk as it arrives: it can be large, and the
	// Raspberry Pi has little memory. Its first bytes say what it is.
	body := bufio.NewReaderSize(http.MaxBytesReader(w, r.Body, maxOwnClip), 512)
	head, err := body.Peek(512)
	if err != nil && len(head) == 0 {
		respond.Error(w, r, a.logger, http.StatusBadRequest, "the video did not arrive")
		return
	}
	ext, ok := ownClipTypes[http.DetectContentType(head)]
	if !ok {
		respond.Error(w, r, a.logger, http.StatusUnsupportedMediaType, errNotAClip.Error())
		return
	}
	dir := filepath.Join(a.dataDir, media.OwnClipsDir)
	name, err := saveOwnFile(dir, id, ext, body)
	if maxErr := (*http.MaxBytesError)(nil); errors.As(err, &maxErr) {
		respond.Error(w, r, a.logger, http.StatusRequestEntityTooLarge, errClipTooLarge.Error())
		return
	}
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	old, err := a.store.setClip(r.Context(), id, &name, false, a.now())
	if err != nil {
		// Nobody uses the new video: it goes.
		a.choiceFailed(w, r, errors.Join(err, removeOwnFile(dir, name)))
		return
	}
	a.chosen(w, r, id, "clip", "video", dir, old)
}

func (a admin) handleRemakeClip(w http.ResponseWriter, r *http.Request) {
	a.clipChoice(w, r, false, "automatic")
}

func (a admin) handleNoClip(w http.ResponseWriter, r *http.Request) {
	a.clipChoice(w, r, true, "none")
}

// clipChoice goes back to the clip FranzPLAY makes, or to none.
func (a admin) clipChoice(w http.ResponseWriter, r *http.Request, none bool, choice string) {
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		respond.Error(w, r, a.logger, http.StatusNotFound, errNotFound.Error())
		return
	}
	old, err := a.store.setClip(r.Context(), id, nil, none, a.now())
	if err != nil {
		a.choiceFailed(w, r, err)
		return
	}
	a.chosen(w, r, id, "clip", choice, filepath.Join(a.dataDir, media.OwnClipsDir), old)
}

// setClip saves the administrator's choice of clip: a video they uploaded
// (own), none at all, or neither for the one FranzPLAY makes. It asks the
// job queue to make the clip again, and returns the video uploaded
// before, if any, which nobody uses any more.
func (s store) setClip(ctx context.Context, id int64, own *string, none bool, now time.Time) (old string, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("choose clip of video %d: %w", id, err)
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, tx.Rollback())
			return
		}
		err = tx.Commit()
	}()
	var missing bool
	var oldOwn sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT missing_since IS NOT NULL, own_clip FROM videos WHERE id = ?`, id).
		Scan(&missing, &oldOwn)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errNotFound
	}
	if err != nil {
		return "", fmt.Errorf("choose clip of video %d: %w", id, err)
	}
	if missing {
		return "", errFileMissing
	}
	if _, err := tx.ExecContext(ctx, `UPDATE videos SET own_clip = ?, no_clip = ? WHERE id = ?`,
		own, none, id); err != nil {
		return "", fmt.Errorf("choose clip of video %d: %w", id, err)
	}
	if err := jobs.Enqueue(ctx, tx, id, jobs.Clip, false, now); err != nil {
		return "", err
	}
	if oldOwn.Valid && (own == nil || *own != oldOwn.String) {
		old = oldOwn.String
	}
	return old, nil
}
