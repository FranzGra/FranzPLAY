package catalog

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/video"
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
	name, err := a.saveChosen(r.Context(), id, content.FileOwnClip+ext, body)
	if maxErr := (*http.MaxBytesError)(nil); errors.As(err, &maxErr) {
		respond.Error(w, r, a.logger, http.StatusRequestEntityTooLarge, errClipTooLarge.Error())
		return
	}
	if err != nil {
		a.choiceFailed(w, r, err)
		return
	}
	old, err := a.store.setClip(r.Context(), id, &name, false, a.now())
	if err != nil {
		// The file stays: it is in the folder of its video, and may be the
		// very one the video had. The next choice writes over it.
		a.choiceFailed(w, r, err)
		return
	}
	a.chosen(w, r, id, "clip", "video", a.root.OwnClips(), old)
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
	a.chosen(w, r, id, "clip", choice, a.root.OwnClips(), old)
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
	if oldOwn.Valid && (own == nil || !content.SameFile(*own, oldOwn.String)) {
		old = oldOwn.String
	}
	return old, nil
}

// The administrator can also choose where the clip FranzPLAY makes starts
// and how long it lasts: for the whole site (clipSettings), and for one
// video, with the slider of its page (clipMoment). The video's choice wins
// and stays for every clip made again later, until it is taken back.

// errBadClipMoment is a start outside the video, or a length the clips
// cannot have.
var errBadClipMoment = fmt.Errorf("the clip starts inside the video and lasts between %d and %d seconds",
	video.MinClipSeconds, video.MaxClipSeconds)

// clipMomentRequest is the body of PUT /api/admin/videos/{id}/clip/moment:
// null second goes back to the site's start, null seconds to its length.
type clipMomentRequest struct {
	Second  *int64 `json:"second"`
	Seconds *int64 `json:"seconds"`
}

func (a admin) handleClipMoment(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		respond.Error(w, r, a.logger, http.StatusNotFound, errNotFound.Error())
		return
	}
	var req clipMomentRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		respond.Error(w, r, a.logger, http.StatusBadRequest, "the request is not valid JSON with the expected fields")
		return
	}
	old, err := a.store.setClipMoment(r.Context(), id, req.Second, req.Seconds, a.now())
	if errors.Is(err, errBadClipMoment) {
		respond.Error(w, r, a.logger, http.StatusBadRequest, errBadClipMoment.Error())
		return
	}
	if err != nil {
		a.choiceFailed(w, r, err)
		return
	}
	a.chosen(w, r, id, "clip", "moment", a.root.OwnClips(), old)
}

// setClipMoment saves where the clip of a video starts and how long it
// lasts, and asks for it to be made again from the video: a video the
// administrator uploaded as clip, or no clip, give way to it. It returns
// the uploaded video, which nobody uses any more.
func (s store) setClipMoment(ctx context.Context, id int64, second, seconds *int64, now time.Time) (old string, err error) {
	if seconds != nil && (*seconds < video.MinClipSeconds || *seconds > video.MaxClipSeconds) {
		return "", errBadClipMoment
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("choose clip moment of video %d: %w", id, err)
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
	err = tx.QueryRowContext(ctx, `SELECT missing_since IS NOT NULL, own_clip, duration FROM videos WHERE id = ?`, id).
		Scan(&missing, &oldOwn, &duration)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errNotFound
	}
	if err != nil {
		return "", fmt.Errorf("choose clip moment of video %d: %w", id, err)
	}
	if missing {
		return "", errFileMissing
	}
	if second != nil {
		if !duration.Valid {
			return "", errNotRead
		}
		if *second < 0 || *second >= duration.Int64 {
			return "", errBadClipMoment
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE videos SET own_clip = NULL, no_clip = 0, clip_second = ?, clip_seconds = ?
		WHERE id = ?`, second, seconds, id); err != nil {
		return "", fmt.Errorf("choose clip moment of video %d: %w", id, err)
	}
	if err := jobs.Enqueue(ctx, tx, id, jobs.Clip, false, now); err != nil {
		return "", err
	}
	if oldOwn.Valid {
		old = oldOwn.String
	}
	return old, nil
}

func (a admin) handleClipSettings(w http.ResponseWriter, r *http.Request) {
	s, err := media.ReadClipSettings(r.Context(), a.store.db)
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	respond.JSON(w, r, a.logger, http.StatusOK, s)
}

// handleSaveClipSettings saves the site's start and length of the clips.
// They are used by the clips made from now on: the ones already made are
// not made again.
func (a admin) handleSaveClipSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		StartPercent *int `json:"startPercent"`
		Seconds      *int `json:"seconds"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil || req.StartPercent == nil || req.Seconds == nil {
		respond.Error(w, r, a.logger, http.StatusBadRequest, "the request is not valid JSON with the expected fields")
		return
	}
	s := media.ClipSettings{StartPercent: *req.StartPercent, Seconds: *req.Seconds}
	err := media.SaveClipSettings(r.Context(), a.store.db, s)
	if errors.Is(err, media.ErrBadClipSettings) {
		respond.Error(w, r, a.logger, http.StatusBadRequest, err.Error())
		return
	}
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	who, _ := a.account(r.Context())
	a.logger.InfoContext(r.Context(), "clip settings saved", "start_percent", s.StartPercent, "seconds", s.Seconds, "by", who.Name)
	respond.JSON(w, r, a.logger, http.StatusOK, s)
}
