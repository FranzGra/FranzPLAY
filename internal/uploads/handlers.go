package uploads

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/FranzGra/FranzPLAY/internal/respond"
)

// maxBody is the largest JSON body accepted by these routes.
const maxBody = 4 << 10

// Routes adds the uploads API to mux, for the logged-in person:
//
//	GET    /api/uploads       my space {quota, used, reserved} and my unfinished uploads
//	POST   /api/uploads       start an upload {name, title, size}: the upload, nothing received yet
//	PUT    /api/uploads/{id}?offset=N  the next piece, as raw bytes starting at byte N:
//	                          the upload, with the new video's id after the last piece
//	DELETE /api/uploads/{id}  stop an upload and throw away what arrived
//
// and the routes of my uploaded videos (videos.go).
func (s *Service) Routes(mux *http.ServeMux) {
	s.videoRoutes(mux)
	mux.HandleFunc("GET /api/uploads", s.handleMine)
	mux.HandleFunc("POST /api/uploads", s.handleStart)
	mux.HandleFunc("PUT /api/uploads/{id}", s.handlePiece)
	mux.HandleFunc("DELETE /api/uploads/{id}", s.handleCancel)
}

// mine is the answer of GET /api/uploads.
type mine struct {
	Space   Space    `json:"space"`
	Uploads []upload `json:"uploads"`
}

func (s *Service) handleMine(w http.ResponseWriter, r *http.Request) {
	a, ok := s.account(r.Context())
	if !ok {
		respond.Error(w, r, s.logger, http.StatusUnauthorized, "login required")
		return
	}
	sp, _, err := s.store.space(r.Context(), s.store.db, a.ID, a.UploadQuota)
	if err != nil {
		respond.InternalError(w, r, s.logger, err)
		return
	}
	list, err := s.store.mine(r.Context(), a.ID)
	if err != nil {
		respond.InternalError(w, r, s.logger, err)
		return
	}
	respond.JSON(w, r, s.logger, http.StatusOK, mine{Space: sp, Uploads: list})
}

func (s *Service) handleStart(w http.ResponseWriter, r *http.Request) {
	a, ok := s.account(r.Context())
	if !ok {
		respond.Error(w, r, s.logger, http.StatusUnauthorized, "login required")
		return
	}
	var req newUpload
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		respond.Error(w, r, s.logger, http.StatusBadRequest, "the request is not valid JSON")
		return
	}
	u, err := s.start(r.Context(), a, req)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	s.logger.InfoContext(r.Context(), "upload started", "id", u.ID, "user", a.Name, "size", u.Size)
	respond.JSON(w, r, s.logger, http.StatusCreated, u)
}

func (s *Service) handlePiece(w http.ResponseWriter, r *http.Request) {
	a, ok := s.account(r.Context())
	if !ok {
		respond.Error(w, r, s.logger, http.StatusUnauthorized, "login required")
		return
	}
	id, ok := s.uploadID(w, r)
	if !ok {
		return
	}
	offset, err := strconv.ParseInt(r.URL.Query().Get("offset"), 10, 64)
	if err != nil || offset < 0 {
		respond.Error(w, r, s.logger, http.StatusBadRequest, "offset must be a number of bytes")
		return
	}
	// The body is never read past the size the browser announced, and
	// never past MaxPiece: fits refuses bigger pieces before anything is read.
	body := http.MaxBytesReader(w, r.Body, MaxPiece)
	u, err := s.receive(r.Context(), a.ID, id, offset, r.ContentLength, body)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if u.Video != 0 {
		s.logger.InfoContext(r.Context(), "upload finished", "id", u.ID, "video", u.Video, "user", a.Name)
	}
	respond.JSON(w, r, s.logger, http.StatusOK, u)
}

func (s *Service) handleCancel(w http.ResponseWriter, r *http.Request) {
	a, ok := s.account(r.Context())
	if !ok {
		respond.Error(w, r, s.logger, http.StatusUnauthorized, "login required")
		return
	}
	id, ok := s.uploadID(w, r)
	if !ok {
		return
	}
	if err := s.cancel(r.Context(), a.ID, id); err != nil {
		s.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// uploadID reads the {id} of the address. When it is not a valid id it
// answers 404 itself and returns false.
func (s *Service) uploadID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		respond.Error(w, r, s.logger, http.StatusNotFound, errNotFound.Error())
		return 0, false
	}
	return id, true
}

// fail answers an error: the ones people can do something about with
// their own words, anything else as an internal error.
func (s *Service) fail(w http.ResponseWriter, r *http.Request, err error) {
	for _, known := range []struct {
		err    error
		status int
	}{
		{errNotAllowed, http.StatusForbidden},
		{errNotVideo, http.StatusBadRequest},
		{errBadName, http.StatusBadRequest},
		{errBadTitle, http.StatusBadRequest},
		{errBadSize, http.StatusBadRequest},
		{errTooMany, http.StatusConflict},
		{errNoSpace, http.StatusRequestEntityTooLarge},
		{errNotFound, http.StatusNotFound},
		{errWrongPlace, http.StatusConflict},
		{errBusy, http.StatusConflict},
		{errDuplicate, http.StatusConflict},
		{errBigPiece, http.StatusRequestEntityTooLarge},
		{errNoLength, http.StatusLengthRequired},
	} {
		if errors.Is(err, known.err) {
			if err != known.err { //nolint:errorlint // on purpose: is it this error and nothing more?
				// The answer is clear, but something else went wrong too.
				s.logger.ErrorContext(r.Context(), "upload", "error", err)
			}
			respond.Error(w, r, s.logger, known.status, known.err.Error())
			return
		}
	}
	respond.InternalError(w, r, s.logger, err)
}
