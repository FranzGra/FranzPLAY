package catalog

import (
	"database/sql"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"

	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/respond"
)

// Routes adds the catalog's API to mux:
//
//	GET /api/videos              list, newest first (?category=&limit=&offset=)
//	GET /api/videos/{id}         one video
//	GET /api/videos/{id}/stream  the video file, with jumps forward and back
//	GET /api/categories          categories with their number of videos
//	GET /api/covers/{name}       a cover image
func Routes(db *sql.DB, dataDir string, logger *slog.Logger) func(mux *http.ServeMux) {
	h := handlers{store: store{db: db}, coversDir: filepath.Join(dataDir, media.CoversDir), logger: logger}
	return func(mux *http.ServeMux) {
		mux.HandleFunc("GET /api/videos", h.list)
		mux.HandleFunc("GET /api/videos/{id}", h.get)
		mux.HandleFunc("GET /api/videos/{id}/stream", h.stream)
		mux.HandleFunc("GET /api/categories", h.categories)
		mux.HandleFunc("GET /api/covers/{name}", h.cover)
	}
}

type handlers struct {
	store     store
	coversDir string
	logger    *slog.Logger
}

// listResponse is the body of GET /api/videos.
type listResponse struct {
	Videos []Video `json:"videos"`
	Total  int     `json:"total"` // all the videos matching, not just this page
}

func (h handlers) list(w http.ResponseWriter, r *http.Request) {
	q, err := parseListQuery(r.URL.Query())
	if err != nil {
		respond.Error(w, r, h.logger, http.StatusBadRequest, err.Error())
		return
	}
	videos, total, err := h.store.list(r.Context(), q)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	respond.JSON(w, r, h.logger, http.StatusOK, listResponse{Videos: videos, Total: total})
}

func (h handlers) get(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
		return
	}
	v, err := h.store.get(r.Context(), id)
	if errors.Is(err, errNotFound) {
		respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
		return
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	respond.JSON(w, r, h.logger, http.StatusOK, v)
}

func (h handlers) categories(w http.ResponseWriter, r *http.Request) {
	cats, err := h.store.categories(r.Context())
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	respond.JSON(w, r, h.logger, http.StatusOK, cats)
}

// stream sends the video file. http.ServeContent answers the browser's
// "from byte X to byte Y" requests (Range), which is what lets the player
// jump forward and back without downloading the whole file.
// The file is only opened for reading (rule 1).
func (h handlers) stream(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
		return
	}
	name, err := h.store.file(r.Context(), id)
	if errors.Is(err, errNotFound) {
		respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
		return
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}

	file, err := os.Open(name)
	if errors.Is(err, fs.ErrNotExist) {
		// Gone since the last scan: the next scan will mark it missing.
		respond.Error(w, r, h.logger, http.StatusNotFound, "video file not found")
		return
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	defer func() {
		if err := file.Close(); err != nil {
			h.logger.WarnContext(r.Context(), "close video file", "error", err)
		}
	}()
	info, err := file.Stat()
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}

	w.Header().Set("Content-Type", contentType(filepath.Ext(name)))
	w.Header().Set("Cache-Control", "private, no-cache")
	http.ServeContent(w, r, "", info.ModTime(), file)
}

// cover sends a cover image. Its name changes when the video changes, so
// the browser may keep it for a year without asking again.
func (h handlers) cover(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !validCoverName(name) {
		respond.Error(w, r, h.logger, http.StatusNotFound, "cover not found")
		return
	}
	file, err := os.Open(filepath.Join(h.coversDir, name))
	if errors.Is(err, fs.ErrNotExist) {
		respond.Error(w, r, h.logger, http.StatusNotFound, "cover not found")
		return
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	defer func() {
		if err := file.Close(); err != nil {
			h.logger.WarnContext(r.Context(), "close cover file", "error", err)
		}
	}()
	info, err := file.Stat()
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeContent(w, r, "", info.ModTime(), file)
}
