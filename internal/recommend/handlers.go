package recommend

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/FranzGra/FranzPLAY/internal/catalog"
	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// How many videos each list has.
const (
	similarLimit = 20 // next to the player
	forYouLimit  = 12 // one row of the Home
)

// videos is what this feature needs from the catalog.
type videos interface {
	ByIDs(ctx context.Context, ids []int64) ([]catalog.Video, error)
}

type handlers struct {
	store  store
	videos videos
	logger *slog.Logger
	// account returns the logged-in person: users.FromContext, replaced
	// only in tests.
	account func(context.Context) (users.Account, bool)
}

// Routes adds the suggestions to mux. Both are for the logged-in person:
//
//	GET /api/videos/{id}/similar  the videos to watch after this one
//	GET /api/recommended          the videos I may like ("Potrebbe piacerti")
//
// Each answers a list of {video, reason}, best first.
func Routes(db *sql.DB, lookup videos, logger *slog.Logger) func(mux *http.ServeMux) {
	return handlers{store: store{db: db}, videos: lookup, logger: logger, account: users.FromContext}.routes
}

func (h handlers) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/videos/{id}/similar", h.similar)
	mux.HandleFunc("GET /api/recommended", h.forYou)
}

// item is one suggested video.
type item struct {
	Video  catalog.Video `json:"video"`
	Reason Reason        `json:"reason"`
}

func (h handlers) similar(w http.ResponseWriter, r *http.Request) {
	a, logged := h.account(r.Context())
	if !logged {
		respond.Error(w, r, h.logger, http.StatusUnauthorized, "login required")
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
		return
	}
	ctx := r.Context()
	all, err := h.store.videos(ctx)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	i := -1
	for j, v := range all {
		if v.ID == id {
			i = j
			break
		}
	}
	if i < 0 {
		respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
		return
	}
	together, err := h.store.together(ctx, id, a.ID)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	finished, err := h.store.finished(ctx, a.ID)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	h.answer(w, r, Similar(all[i], all, together, finished, similarLimit))
}

func (h handlers) forYou(w http.ResponseWriter, r *http.Request) {
	a, logged := h.account(r.Context())
	if !logged {
		respond.Error(w, r, h.logger, http.StatusUnauthorized, "login required")
		return
	}
	ctx := r.Context()
	all, err := h.store.videos(ctx)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	taste, err := h.store.taste(ctx, a.ID)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	others, err := h.store.others(ctx, a.ID)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	h.answer(w, r, ForYou(all, taste, others, forYouLimit))
}

// answer sends the picks with each video's details, in the same order.
func (h handlers) answer(w http.ResponseWriter, r *http.Request, picks []Pick) {
	ids := make([]int64, len(picks))
	reasons := make(map[int64]Reason, len(picks))
	for i, p := range picks {
		ids[i] = p.ID
		reasons[p.ID] = p.Reason
	}
	found, err := h.videos.ByIDs(r.Context(), ids)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	out := make([]item, 0, len(found))
	for _, v := range found {
		out = append(out, item{Video: v, Reason: reasons[v.ID]})
	}
	respond.JSON(w, r, h.logger, http.StatusOK, out)
}
