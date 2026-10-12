package comments

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

type handlers struct {
	store  store
	logger *slog.Logger
	now    func() time.Time
	// account returns the logged-in person: users.FromContext, replaced
	// only in tests.
	account func(context.Context) (users.Account, bool)
}

// Routes adds the comments API to mux, for logged-in people:
//
//	GET    /api/videos/{id}/comments  the conversations, newest first
//	POST   /api/videos/{id}/comments  {body, parentId?}: write, or answer a comment
//	DELETE /api/comments/{id}         delete (author or administrator), with its replies
//	GET    /api/comments              every comment, newest first (administrators; ?limit=&offset=)
func Routes(db *sql.DB, logger *slog.Logger) func(mux *http.ServeMux) {
	return handlers{store: store{db: db}, logger: logger, now: time.Now, account: users.FromContext}.routes
}

func (h handlers) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/videos/{id}/comments", h.list)
	mux.HandleFunc("POST /api/videos/{id}/comments", h.add)
	mux.HandleFunc("DELETE /api/comments/{id}", h.remove)
	mux.HandleFunc("GET /api/comments", h.recent)
}

// who returns the person asking and the id in the address.
func (h handlers) who(w http.ResponseWriter, r *http.Request, notFound error) (viewer, int64, bool) {
	a, logged := h.account(r.Context())
	if !logged {
		respond.Error(w, r, h.logger, http.StatusUnauthorized, "login required")
		return viewer{}, 0, false
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		respond.Error(w, r, h.logger, http.StatusNotFound, notFound.Error())
		return viewer{}, 0, false
	}
	return viewer{id: a.ID, admin: a.Role == users.Admin}, id, true
}

// video checks the video of the address; it answers itself when it is not there.
func (h handlers) video(w http.ResponseWriter, r *http.Request, videoID int64) bool {
	err := h.store.present(r.Context(), videoID)
	if errors.Is(err, errVideoNotFound) {
		respond.Error(w, r, h.logger, http.StatusNotFound, err.Error())
		return false
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return false
	}
	return true
}

func (h handlers) list(w http.ResponseWriter, r *http.Request) {
	v, videoID, ok := h.who(w, r, errVideoNotFound)
	if !ok || !h.video(w, r, videoID) {
		return
	}
	rows, err := h.store.list(r.Context(), videoID)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	respond.JSON(w, r, h.logger, http.StatusOK, thread(rows, v))
}

type addRequest struct {
	Body     string `json:"body"`
	ParentID int64  `json:"parentId"` // 0 or missing = a new conversation
}

func (h handlers) add(w http.ResponseWriter, r *http.Request) {
	v, videoID, ok := h.who(w, r, errVideoNotFound)
	if !ok || !h.video(w, r, videoID) {
		return
	}
	var req addRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		respond.Error(w, r, h.logger, http.StatusBadRequest, `the request must be {"body": text, "parentId": number}`)
		return
	}
	body, err := cleanBody(req.Body)
	if err != nil {
		respond.Error(w, r, h.logger, http.StatusBadRequest, err.Error())
		return
	}
	parentID := int64(0)
	if req.ParentID != 0 {
		parent, err := h.store.get(r.Context(), req.ParentID)
		if err == nil {
			parentID, err = replyTarget(parent, videoID)
		}
		if errors.Is(err, errCommentNotFound) {
			respond.Error(w, r, h.logger, http.StatusBadRequest, "the comment to answer is not under this video")
			return
		}
		if err != nil {
			respond.InternalError(w, r, h.logger, err)
			return
		}
	}
	saved, err := h.store.add(r.Context(), videoID, v.id, parentID, body, h.now())
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	respond.JSON(w, r, h.logger, http.StatusCreated, v.comment(saved))
}

func (h handlers) remove(w http.ResponseWriter, r *http.Request) {
	v, id, ok := h.who(w, r, errCommentNotFound)
	if !ok {
		return
	}
	c, err := h.store.get(r.Context(), id)
	if errors.Is(err, errCommentNotFound) {
		respond.Error(w, r, h.logger, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	if !canDelete(v.id, v.admin, c.userID) {
		respond.Error(w, r, h.logger, http.StatusForbidden, errNotYours.Error())
		return
	}
	if err := h.store.remove(r.Context(), id); err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
