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
//	GET  /api/videos/{id}/progress  where I stopped: {position, finished}
//	POST /api/videos/{id}/progress  {position}: sent by the player while watching
//	GET  /api/continue              the videos I am in the middle of
func Routes(db *sql.DB, lookup videos, logger *slog.Logger) func(mux *http.ServeMux) {
	return handlers{store: store{db: db}, videos: lookup, logger: logger, now: time.Now, account: users.FromContext}.routes
}

func (h handlers) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/videos/{id}/progress", h.get)
	mux.HandleFunc("POST /api/videos/{id}/progress", h.save)
	mux.HandleFunc("GET /api/continue", h.list)
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

// continueItem is one video of GET /api/continue.
type continueItem struct {
	Video    catalog.Video `json:"video"`
	Position int64         `json:"position"`
}

func (h handlers) list(w http.ResponseWriter, r *http.Request) {
	a, logged := h.account(r.Context())
	if !logged {
		respond.Error(w, r, h.logger, http.StatusUnauthorized, "login required")
		return
	}
	marks, err := h.store.inProgress(r.Context(), a.ID, continueLimit)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	ids := make([]int64, len(marks))
	position := make(map[int64]int64, len(marks))
	for i, m := range marks {
		ids[i] = m.videoID
		position[m.videoID] = m.position
	}
	found, err := h.videos.ByIDs(r.Context(), ids)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	items := make([]continueItem, 0, len(found))
	for _, v := range found {
		items = append(items, continueItem{Video: v, Position: position[v.ID]})
	}
	respond.JSON(w, r, h.logger, http.StatusOK, items)
}
