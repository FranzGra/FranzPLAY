package likes

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/catalog"
	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// videos is what this feature needs from the catalog.
type videos interface {
	ByIDs(ctx context.Context, ids []int64) ([]catalog.Video, error)
}

type handlers struct {
	store  store
	videos videos
	logger *slog.Logger
	now    func() time.Time
	// account returns the logged-in person: users.FromContext, replaced
	// only in tests.
	account func(context.Context) (users.Account, bool)
}

// Routes adds the likes API to mux, for the logged-in person:
//
//	GET    /api/videos/{id}/like  {liked, count}
//	PUT    /api/videos/{id}/like  I like it; answers {liked, count}
//	DELETE /api/videos/{id}/like  I no longer like it; answers {liked, count}
//	GET    /api/likes             the videos I like, the last liked first (limit, offset)
func Routes(db *sql.DB, lookup videos, logger *slog.Logger) func(mux *http.ServeMux) {
	return handlers{store: store{db: db}, videos: lookup, logger: logger, now: time.Now, account: users.FromContext}.routes
}

func (h handlers) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/videos/{id}/like", func(w http.ResponseWriter, r *http.Request) { h.answer(w, r, nil) })
	mux.HandleFunc("PUT /api/videos/{id}/like", func(w http.ResponseWriter, r *http.Request) { h.answer(w, r, new(true)) })
	mux.HandleFunc("DELETE /api/videos/{id}/like", func(w http.ResponseWriter, r *http.Request) { h.answer(w, r, new(false)) })
	mux.HandleFunc("GET /api/likes", h.list)
}

// videoList is the answer of GET /api/likes, shaped like the catalog's
// lists so the interface shows it the same way.
type videoList struct {
	Videos []catalog.Video `json:"videos"`
	Total  int             `json:"total"` // all the videos I like, not just this page
}

func (h handlers) list(w http.ResponseWriter, r *http.Request) {
	a, logged := h.account(r.Context())
	if !logged {
		respond.Error(w, r, h.logger, http.StatusUnauthorized, "login required")
		return
	}
	limit, offset, err := parsePage(r.URL.Query())
	if err != nil {
		respond.Error(w, r, h.logger, http.StatusBadRequest, err.Error())
		return
	}
	ids, total, err := h.store.liked(r.Context(), a.ID, limit, offset)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	found, err := h.videos.ByIDs(r.Context(), ids)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	respond.JSON(w, r, h.logger, http.StatusOK, videoList{Videos: found, Total: total})
}

// answer changes the like when set is not nil, then answers with the
// like as it is now.
func (h handlers) answer(w http.ResponseWriter, r *http.Request, set *bool) {
	a, logged := h.account(r.Context())
	if !logged {
		respond.Error(w, r, h.logger, http.StatusUnauthorized, "login required")
		return
	}
	videoID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || videoID <= 0 {
		respond.Error(w, r, h.logger, http.StatusNotFound, errVideoNotFound.Error())
		return
	}
	if err := h.store.present(r.Context(), videoID); errors.Is(err, errVideoNotFound) {
		respond.Error(w, r, h.logger, http.StatusNotFound, err.Error())
		return
	} else if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	if set != nil {
		if err := h.store.set(r.Context(), a.ID, videoID, *set, h.now()); err != nil {
			respond.InternalError(w, r, h.logger, err)
			return
		}
	}
	l, err := h.store.get(r.Context(), a.ID, videoID)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	respond.JSON(w, r, h.logger, http.StatusOK, l)
}
