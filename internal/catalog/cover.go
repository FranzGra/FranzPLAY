package catalog

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/respond"
)

// The administrator can choose the cover of a video: an image of their
// own, or a moment of the video. The image is kept in the data folder
// (rule 1: nothing is written next to the video); the cover job then makes
// the cover from it, so the choice survives every new reading of the
// folders and every search on the internet.

// maxOwnCover is the largest image accepted as a cover. Photos from a
// phone stay well below it.
const maxOwnCover = 10 << 20

// ownCoverTypes are the images accepted, with the extension they are kept
// with.
var ownCoverTypes = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
}

// Errors shown to people.
var (
	errNotAnImage     = errors.New("the cover must be a JPEG, PNG or WebP image")
	errImageTooLarge  = errors.New("the image is too large: at most 10 MB")
	errNotRead        = errors.New("the video has not been read yet: its length is unknown")
	errBadCoverSecond = errors.New("the moment must be inside the video")
)

// ownCoverExt says whether data is an image accepted as a cover, and the
// extension to keep it with. It looks at the content, not at what the
// browser says it is.
func ownCoverExt(data []byte) (string, bool) {
	ext, ok := ownCoverTypes[http.DetectContentType(data)]
	return ext, ok
}

// coverRequest is the body of PUT /api/admin/videos/{id}/cover-second.
type coverRequest struct {
	Second *int64 `json:"second"`
}

func (a admin) handleOwnCover(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		respond.Error(w, r, a.logger, http.StatusNotFound, errNotFound.Error())
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxOwnCover))
	if maxErr := (*http.MaxBytesError)(nil); errors.As(err, &maxErr) {
		respond.Error(w, r, a.logger, http.StatusRequestEntityTooLarge, errImageTooLarge.Error())
		return
	}
	if err != nil {
		respond.Error(w, r, a.logger, http.StatusBadRequest, "the image did not arrive whole")
		return
	}
	ext, ok := ownCoverExt(data)
	if !ok {
		respond.Error(w, r, a.logger, http.StatusUnsupportedMediaType, errNotAnImage.Error())
		return
	}
	dir := filepath.Join(a.dataDir, media.OwnCoversDir)
	name, err := media.SaveOwnFile(dir, id, ext, bytes.NewReader(data))
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	old, err := a.store.setCover(r.Context(), id, &name, nil, a.now())
	if err != nil {
		// Nobody uses the new image: it goes.
		err = errors.Join(err, media.RemoveOwnFile(dir, name))
		a.choiceFailed(w, r, err)
		return
	}
	a.chosen(w, r, id, "cover", "image", dir, old)
}

func (a admin) handleCoverSecond(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		respond.Error(w, r, a.logger, http.StatusNotFound, errNotFound.Error())
		return
	}
	var req coverRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil || req.Second == nil {
		respond.Error(w, r, a.logger, http.StatusBadRequest, "the request is not valid JSON with the expected fields")
		return
	}
	old, err := a.store.setCover(r.Context(), id, nil, req.Second, a.now())
	if err != nil {
		a.choiceFailed(w, r, err)
		return
	}
	a.chosen(w, r, id, "cover", "moment", filepath.Join(a.dataDir, media.OwnCoversDir), old)
}

func (a admin) handleResetCover(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		respond.Error(w, r, a.logger, http.StatusNotFound, errNotFound.Error())
		return
	}
	old, err := a.store.setCover(r.Context(), id, nil, nil, a.now())
	if err != nil {
		a.choiceFailed(w, r, err)
		return
	}
	a.chosen(w, r, id, "cover", "automatic", filepath.Join(a.dataDir, media.OwnCoversDir), old)
}

// chosen finishes a change of cover or clip: the file uploaded before
// goes, the job worker and the pages are told. what is "cover" or "clip".
func (a admin) chosen(w http.ResponseWriter, r *http.Request, id int64, what, choice, dir, old string) {
	if old != "" {
		if err := media.RemoveOwnFile(dir, old); err != nil {
			// The choice is saved; the old file is removed at the next start.
			a.logger.WarnContext(r.Context(), "remove old uploaded file", "video", id, "what", what, "error", err)
		}
	}
	who, _ := a.account(r.Context())
	a.logger.InfoContext(r.Context(), what+" chosen", "video", id, "choice", choice, "by", who.Name)
	a.queued()
	a.changed()
	w.WriteHeader(http.StatusNoContent)
}

func (a admin) choiceFailed(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errNotFound):
		respond.Error(w, r, a.logger, http.StatusNotFound, errNotFound.Error())
	case errors.Is(err, errFileMissing):
		respond.Error(w, r, a.logger, http.StatusConflict, errFileMissing.Error())
	case errors.Is(err, errNotRead):
		respond.Error(w, r, a.logger, http.StatusConflict, errNotRead.Error())
	case errors.Is(err, errBadCoverSecond):
		respond.Error(w, r, a.logger, http.StatusBadRequest, errBadCoverSecond.Error())
	default:
		respond.InternalError(w, r, a.logger, err)
	}
}

// setCover saves the administrator's choice of cover: an uploaded image
// (own), a moment of the video (second), or neither for FranzPLAY's own.
// It asks the job queue to make the cover again, and returns the image
// uploaded before, if any, which nobody uses any more.
func (s store) setCover(ctx context.Context, id int64, own *string, second *int64, now time.Time) (old string, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("choose cover of video %d: %w", id, err)
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
	var duration sql.NullInt64
	err = tx.QueryRowContext(ctx, `SELECT missing_since IS NOT NULL, own_cover, duration FROM videos WHERE id = ?`, id).
		Scan(&missing, &oldOwn, &duration)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errNotFound
	}
	if err != nil {
		return "", fmt.Errorf("choose cover of video %d: %w", id, err)
	}
	if missing {
		return "", errFileMissing
	}
	if second != nil {
		if !duration.Valid {
			return "", errNotRead
		}
		if *second < 0 || *second > duration.Int64 {
			return "", errBadCoverSecond
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE videos SET own_cover = ?, cover_second = ? WHERE id = ?`,
		own, second, id); err != nil {
		return "", fmt.Errorf("choose cover of video %d: %w", id, err)
	}
	if err := jobs.Enqueue(ctx, tx, id, jobs.Cover, false, now); err != nil {
		return "", err
	}
	if oldOwn.Valid && (own == nil || *own != oldOwn.String) {
		old = oldOwn.String
	}
	return old, nil
}
