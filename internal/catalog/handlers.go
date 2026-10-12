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
//	GET /api/videos                       list, newest first (?category=&uploader=&q=&limit=&offset=);
//	                                      mixed with ?order=random&seed=N
//	GET /api/videos/{id}                  one video
//	GET /api/videos/{id}/stream           the video file, with jumps forward and back
//	GET /api/videos/{id}/subtitles        the subtitles next to the video file, inside it and made by whisper
//	GET /api/videos/{id}/subtitles/{key}  one subtitle, as WebVTT
//	GET /api/categories                   categories with their number of videos
//	GET /api/covers/{name}                a cover image
//	GET /api/previews/{name}              the frames shown over the timeline
//	GET /api/clips/{name}                 the seconds that play on a video's card
func Routes(db *sql.DB, dataDir string, logger *slog.Logger) func(mux *http.ServeMux) {
	h := handlers{store: store{db: db}, subtitlesDir: filepath.Join(dataDir, media.SubtitlesDir),
		autoSubtitlesDir: filepath.Join(dataDir, media.AutoSubtitlesDir),
		convertedDir:     filepath.Join(dataDir, media.ConvertedDir), logger: logger}
	return func(mux *http.ServeMux) {
		mux.HandleFunc("GET /api/videos", h.list)
		mux.HandleFunc("GET /api/videos/{id}", h.get)
		mux.HandleFunc("GET /api/videos/{id}/stream", h.stream)
		mux.HandleFunc("GET /api/videos/{id}/subtitles", h.subtitles)
		mux.HandleFunc("GET /api/videos/{id}/subtitles/{key}", h.subtitle)
		mux.HandleFunc("GET /api/categories", h.categories)
		mux.HandleFunc("GET /api/covers/{name}", h.image(filepath.Join(dataDir, media.CoversDir)))
		mux.HandleFunc("GET /api/previews/{name}", h.image(filepath.Join(dataDir, media.PreviewsDir)))
		mux.HandleFunc("GET /api/clips/{name}", h.made(filepath.Join(dataDir, media.ClipsDir), ".mp4", "video/mp4"))
	}
}

type handlers struct {
	store        store
	subtitlesDir string // the copies of the subtitles inside the videos
	// autoSubtitlesDir holds the subtitles written by whisper.
	autoSubtitlesDir string
	convertedDir     string // the copies of the videos not every browser plays
	logger           *slog.Logger
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
// A video not every browser plays is sent as its copy, when it is ready.
// The file is only opened for reading (rule 1).
func (h handlers) stream(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
		return
	}
	name, _, err := h.store.played(r.Context(), id, h.convertedDir)
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

// image serves the JPEG images FranzPLAY made in dir: covers or previews.
func (h handlers) image(dir string) http.HandlerFunc {
	return h.made(dir, ".jpg", "image/jpeg")
}

// made serves the files FranzPLAY made in dir, all ending in ext: images,
// or the clips that play on the cards. Their names change with the
// content, so the browser may keep them for a year without asking again.
func (h handlers) made(dir, ext, contentType string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		if !validMadeName(name, ext) {
			respond.Error(w, r, h.logger, http.StatusNotFound, "file not found")
			return
		}
		file, err := os.Open(filepath.Join(dir, name))
		if errors.Is(err, fs.ErrNotExist) {
			respond.Error(w, r, h.logger, http.StatusNotFound, "file not found")
			return
		}
		if err != nil {
			respond.InternalError(w, r, h.logger, err)
			return
		}
		defer func() {
			if err := file.Close(); err != nil {
				h.logger.WarnContext(r.Context(), "close made file", "error", err)
			}
		}()
		info, err := file.Stat()
		if err != nil {
			respond.InternalError(w, r, h.logger, err)
			return
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		http.ServeContent(w, r, "", info.ModTime(), file)
	}
}
