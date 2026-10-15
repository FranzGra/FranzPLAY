package sharing

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// PublicLink is the address of the page anybody may open, without an
// account, to watch one video.
func PublicLink(key string) string { return "/p/" + key }

// publicLinkResponse is the answer of the addresses of a video's public link.
type publicLinkResponse struct {
	Link      *string    `json:"link"`      // "/p/…"; null = no public link
	CreatedAt *time.Time `json:"createdAt"` // when the current link was made
}

type publicHandlers struct {
	db      *sql.DB
	logger  *slog.Logger
	now     func() time.Time
	account func(context.Context) (users.Account, bool)
}

// PublicRoutes adds to mux the public link of a video, for its owner:
//
//	GET    /api/videos/{id}/public-link   the link, if there is one
//	POST   /api/videos/{id}/public-link   make a new link, replacing the old one
//	DELETE /api/videos/{id}/public-link   revoke it: the address stops working
//
// Only who may share in public (an administrator, or a person the
// administrator allowed) may use them, and only on their own uploads; an
// administrator also on every video of the folders. The video itself is
// served to guests by catalog.PublicRoutes.
func PublicRoutes(db *sql.DB, logger *slog.Logger) func(mux *http.ServeMux) {
	h := publicHandlers{db: db, logger: logger, now: time.Now, account: users.FromContext}
	return h.routes
}

func (h publicHandlers) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/videos/{id}/public-link", h.get)
	mux.HandleFunc("POST /api/videos/{id}/public-link", h.create)
	mux.HandleFunc("DELETE /api/videos/{id}/public-link", h.revoke)
}

// errNotYours means the video does not exist, or is not the person's to share.
var errNotYours = errors.New("video not found")

// allowed checks the person and the video: the answer is false once the
// refusal is sent.
func (h publicHandlers) allowed(w http.ResponseWriter, r *http.Request) (users.Account, int64, bool) {
	a, ok := h.account(r.Context())
	if !ok {
		respond.Error(w, r, h.logger, http.StatusUnauthorized, "login required")
		return users.Account{}, 0, false
	}
	if !a.MaySharePublic() {
		respond.Error(w, r, h.logger, http.StatusForbidden, "you may not make public links")
		return users.Account{}, 0, false
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		respond.Error(w, r, h.logger, http.StatusNotFound, errNotYours.Error())
		return users.Account{}, 0, false
	}
	var uploader sql.NullInt64
	err = h.db.QueryRowContext(r.Context(), `SELECT uploaded_by FROM videos
		WHERE id = ? AND missing_since IS NULL AND hidden_at IS NULL`, id).Scan(&uploader)
	mine := err == nil && (a.Role == users.Admin || (uploader.Valid && uploader.Int64 == a.ID))
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !mine) {
		respond.Error(w, r, h.logger, http.StatusNotFound, errNotYours.Error())
		return users.Account{}, 0, false
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, fmt.Errorf("read video %d: %w", id, err))
		return users.Account{}, 0, false
	}
	return a, id, true
}

func (h publicHandlers) get(w http.ResponseWriter, r *http.Request) {
	_, id, ok := h.allowed(w, r)
	if !ok {
		return
	}
	var key string
	var created int64
	err := h.db.QueryRowContext(r.Context(), `SELECT token, created_at FROM public_links WHERE video_id = ?`, id).
		Scan(&key, &created)
	if errors.Is(err, sql.ErrNoRows) {
		respond.JSON(w, r, h.logger, http.StatusOK, publicLinkResponse{})
		return
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, fmt.Errorf("read public link of video %d: %w", id, err))
		return
	}
	respond.JSON(w, r, h.logger, http.StatusOK, linkAnswer(key, created))
}

func linkAnswer(key string, created int64) publicLinkResponse {
	link := PublicLink(key)
	at := time.Unix(created, 0).UTC()
	return publicLinkResponse{Link: &link, CreatedAt: &at}
}

// create makes a new key: the old link, if any, stops working.
func (h publicHandlers) create(w http.ResponseWriter, r *http.Request) {
	a, id, ok := h.allowed(w, r)
	if !ok {
		return
	}
	key, err := NewKey()
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	now := h.now().Unix()
	if _, err := h.db.ExecContext(r.Context(), `
		INSERT INTO public_links (video_id, token, created_by, created_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (video_id) DO UPDATE SET token = excluded.token, created_by = excluded.created_by,
			created_at = excluded.created_at`, id, key, a.ID, now); err != nil {
		respond.InternalError(w, r, h.logger, fmt.Errorf("make public link of video %d: %w", id, err))
		return
	}
	h.logger.InfoContext(r.Context(), "public link made", "video", id, "by", a.Name)
	respond.JSON(w, r, h.logger, http.StatusOK, linkAnswer(key, now))
}

func (h publicHandlers) revoke(w http.ResponseWriter, r *http.Request) {
	a, id, ok := h.allowed(w, r)
	if !ok {
		return
	}
	if _, err := h.db.ExecContext(r.Context(), `DELETE FROM public_links WHERE video_id = ?`, id); err != nil {
		respond.InternalError(w, r, h.logger, fmt.Errorf("revoke public link of video %d: %w", id, err))
		return
	}
	h.logger.InfoContext(r.Context(), "public link revoked", "video", id, "by", a.Name)
	w.WriteHeader(http.StatusNoContent)
}
