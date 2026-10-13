package catalog

import (
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"path/filepath"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/respond"
)

// copyState says where the copy of a video for every device is.
type copyState string

const (
	copyReady   copyState = "ready"   // made: the stream sends it
	copyWaiting copyState = "waiting" // in the queue
	copyWorking copyState = "working" // being made now
	copyFailed  copyState = "failed"  // could not be made
	copyNone    copyState = "none"    // none is made: FranzPLAY thinks the file plays as it is
)

// prepareResponse is the answer of POST /api/videos/{id}/prepare.
type prepareResponse struct {
	State copyState `json:"state"`
	// Percent is how much of the copy is made, while it is being made
	// and its video's length is known; 0 to 99.
	Percent *int `json:"percent,omitempty"`
}

type prepareHandlers struct {
	store        store
	dataDir      string
	convertedDir string
	hurried      func() // the queue changed: wake the worker, tell the pages
	now          func() time.Time
	logger       *slog.Logger
}

// PrepareRoutes adds the API a player calls when the device cannot play
// a video and its copy is not ready yet:
//
//	POST /api/videos/{id}/prepare   make its copy before every other job; answers where it is
//
// Calling it again only answers where the copy is.
func PrepareRoutes(db *sql.DB, dataDir string, hurried func(), logger *slog.Logger) func(mux *http.ServeMux) {
	h := prepareHandlers{store: store{db: db}, dataDir: dataDir, convertedDir: filepath.Join(dataDir, media.ConvertedDir),
		hurried: hurried, now: time.Now, logger: logger}
	return func(mux *http.ServeMux) {
		mux.HandleFunc("POST /api/videos/{id}/prepare", h.prepare)
	}
}

func (h prepareHandlers) prepare(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
		return
	}
	// Only a video the person may watch.
	_, isCopy, err := h.store.played(r.Context(), id, h.convertedDir, false)
	if errors.Is(err, errNotFound) {
		respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
		return
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	if isCopy {
		respond.JSON(w, r, h.logger, http.StatusOK, prepareResponse{State: copyReady})
		return
	}
	hurried, err := jobs.Hurry(r.Context(), h.store.db, id, jobs.Convert, h.now())
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	if hurried {
		h.hurried()
	}
	answer, err := h.copyState(r, id)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	respond.JSON(w, r, h.logger, http.StatusOK, answer)
}

// copyState reads where the copy of a video is.
func (h prepareHandlers) copyState(r *http.Request, id int64) (prepareResponse, error) {
	var converted bool
	var job sql.NullString
	var duration sql.NullInt64
	err := h.store.db.QueryRowContext(r.Context(), `
		SELECT v.converted IS NOT NULL, j.state, v.duration FROM videos v
		LEFT JOIN jobs j ON j.video_id = v.id AND j.kind = 'convert'
		WHERE v.id = ?`, id).Scan(&converted, &job, &duration)
	if err != nil {
		return prepareResponse{}, fmt.Errorf("read copy of video %d: %w", id, err)
	}
	switch {
	case converted:
		return prepareResponse{State: copyReady}, nil
	case job.String == "pending":
		return prepareResponse{State: copyWaiting}, nil
	case job.String == "failed":
		return prepareResponse{State: copyFailed}, nil
	case job.String != "running":
		return prepareResponse{State: copyNone}, nil
	}
	answer := prepareResponse{State: copyWorking}
	done, ok, err := media.ConvertedSoFar(h.dataDir, id)
	if err != nil {
		return prepareResponse{}, err
	}
	if ok && duration.Int64 > 0 {
		percent := min(99, max(0, int(100*done/float64(duration.Int64))))
		answer.Percent = &percent
	}
	return answer, nil
}
