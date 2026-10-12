package progress

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/catalog"
	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// continueLimit is how many videos "Continua a guardare" shows.
const continueLimit = 20

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

// Routes adds the progress API to mux. Every route works for the
// logged-in person only:
//
//	GET    /api/videos/{id}/progress where I stopped: {position, finished}
//	POST   /api/videos/{id}/progress {position}: sent by the player while watching
//	GET    /api/continue             the videos I am in the middle of
//	DELETE /api/continue/{id}        take one out, keeping it in the history
//	GET    /api/history              what I watched, most recent first (limit, offset)
//	DELETE /api/history              forget everything I watched
//	DELETE /api/history/{id}         forget one video
func Routes(db *sql.DB, lookup videos, logger *slog.Logger) func(mux *http.ServeMux) {
	return handlers{store: store{db: db}, videos: lookup, logger: logger, now: time.Now, account: users.FromContext}.routes
}

func (h handlers) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/videos/{id}/progress", h.get)
	mux.HandleFunc("POST /api/videos/{id}/progress", h.save)
	mux.HandleFunc("GET /api/continue", h.list)
	mux.HandleFunc("DELETE /api/continue/{id}", h.leaveContinue)
	mux.HandleFunc("GET /api/history", h.history)
	mux.HandleFunc("DELETE /api/history", h.forgetAll)
	mux.HandleFunc("DELETE /api/history/{id}", h.forgetOne)
}

// request returns the logged-in person and the video id of the address.
func (h handlers) request(w http.ResponseWriter, r *http.Request) (userID, videoID int64, ok bool) {
	a, logged := h.account(r.Context())
	if !logged {
		respond.Error(w, r, h.logger, http.StatusUnauthorized, "login required")
		return 0, 0, false
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		respond.Error(w, r, h.logger, http.StatusNotFound, errVideoNotFound.Error())
		return 0, 0, false
	}
	return a.ID, id, true
}

func (h handlers) get(w http.ResponseWriter, r *http.Request) {
	userID, videoID, ok := h.request(w, r)
	if !ok {
		return
	}
	m, err := h.store.get(r.Context(), userID, videoID)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	respond.JSON(w, r, h.logger, http.StatusOK, m)
}

type saveRequest struct {
	Position float64 `json:"position"`
}

func (h handlers) save(w http.ResponseWriter, r *http.Request) {
	userID, videoID, ok := h.request(w, r)
	if !ok {
		return
	}
	var req saveRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		respond.Error(w, r, h.logger, http.StatusBadRequest, "the request must be {\"position\": seconds}")
		return
	}
	duration, err := h.store.duration(r.Context(), videoID)
	if errors.Is(err, errVideoNotFound) {
		respond.Error(w, r, h.logger, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	m, err := mark(req.Position, duration)
	if err != nil {
		respond.Error(w, r, h.logger, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.store.save(r.Context(), userID, videoID, m, h.now()); err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	respond.JSON(w, r, h.logger, http.StatusOK, m)
}

// item is one video of the history or of "Continua a guardare".
type item struct {
	Video     catalog.Video `json:"video"`
	Position  int64         `json:"position"`
	Finished  bool          `json:"finished"`
	WatchedAt time.Time     `json:"watchedAt"`
}

// items adds each video's details to what was watched, in the same order.
func (h handlers) items(ctx context.Context, list []watched) ([]item, error) {
	ids := make([]int64, len(list))
	byID := make(map[int64]watched, len(list))
	for i, w := range list {
		ids[i] = w.videoID
		byID[w.videoID] = w
	}
	found, err := h.videos.ByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]item, 0, len(found))
	for _, v := range found {
		w := byID[v.ID]
		out = append(out, item{Video: v, Position: w.position, Finished: w.finished, WatchedAt: w.at})
	}
	return out, nil
}

func (h handlers) list(w http.ResponseWriter, r *http.Request) {
	a, logged := h.account(r.Context())
	if !logged {
		respond.Error(w, r, h.logger, http.StatusUnauthorized, "login required")
		return
	}
	started, _, err := h.store.list(r.Context(), a.ID, true, continueLimit, 0)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	items, err := h.items(r.Context(), started)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	respond.JSON(w, r, h.logger, http.StatusOK, items)
}

// historyPage is the answer of GET /api/history.
type historyPage struct {
	Items []item `json:"items"`
	Total int    `json:"total"` // all the videos in the history, not just this page
}

func (h handlers) history(w http.ResponseWriter, r *http.Request) {
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
	list, total, err := h.store.list(r.Context(), a.ID, false, limit, offset)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	items, err := h.items(r.Context(), list)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	respond.JSON(w, r, h.logger, http.StatusOK, historyPage{Items: items, Total: total})
}

// leaveContinue takes one video out of "Continua a guardare". The history
// keeps it, with where the person stopped; watching it again puts it back.
func (h handlers) leaveContinue(w http.ResponseWriter, r *http.Request) {
	userID, videoID, ok := h.request(w, r)
	if !ok {
		return
	}
	left, err := h.store.leaveContinue(r.Context(), userID, videoID)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	if !left {
		respond.Error(w, r, h.logger, http.StatusNotFound, "this video is not in Continua a guardare")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// forgetOne removes one video from the history (and so from "Continua a
// guardare"): the next time it starts from the beginning.
func (h handlers) forgetOne(w http.ResponseWriter, r *http.Request) {
	userID, videoID, ok := h.request(w, r)
	if !ok {
		return
	}
	n, err := h.store.forget(r.Context(), userID, videoID)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	if n == 0 {
		respond.Error(w, r, h.logger, http.StatusNotFound, "this video is not in the history")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// forgetAll empties the history of the logged-in person.
func (h handlers) forgetAll(w http.ResponseWriter, r *http.Request) {
	a, logged := h.account(r.Context())
	if !logged {
		respond.Error(w, r, h.logger, http.StatusUnauthorized, "login required")
		return
	}
	if _, err := h.store.forget(r.Context(), a.ID, 0); err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
