package catalog

import (
	"database/sql"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"

	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/respond"
)

// Routes adds the catalog's API to mux:
//
//	GET /api/videos                       list, newest first (?category=&uploader=&shared=1&q=&limit=&offset=);
//	                                      mixed with ?order=random&seed=N
//	GET /api/videos/{id}                  one video
//	GET /api/videos/{id}/stream           the video file, with jumps forward and back: its copy for
//	                                      every device when there is one, the file itself with ?original=1
//	GET /api/videos/{id}/subtitles        the subtitles next to the video file, inside it and made by whisper
//	GET /api/videos/{id}/subtitles/{key}  one subtitle, as WebVTT
//	GET /api/categories                   categories with their number of videos, color and image
//	GET /api/category-images/{name}       the image of a category
//	GET /api/category-pictures/{name}     a picture found in the folder of a category
//	GET /api/covers/{name}                a cover image
//	GET /api/previews/{name}              the frames shown over the timeline
//	GET /api/clips/{name}                 the seconds that play on a video's card
//	GET /api/clips-hd/{name}              the same seconds, sharper, for a good connection
func Routes(db *sql.DB, root content.Root, logger *slog.Logger) func(mux *http.ServeMux) {
	h := handlers{store: store{db: db}, root: root, logger: logger}
	return func(mux *http.ServeMux) {
		mux.HandleFunc("GET /api/videos", h.list)
		mux.HandleFunc("GET /api/videos/{id}", h.get)
		mux.HandleFunc("GET /api/videos/{id}/stream", h.stream)
		mux.HandleFunc("GET /api/videos/{id}/subtitles", h.subtitles)
		mux.HandleFunc("GET /api/videos/{id}/subtitles/{key}", h.subtitle)
		mux.HandleFunc("GET /api/categories", h.categories)
		mux.HandleFunc("GET /api/category-images/{name}", h.image(root.CategoryImages(), root.OldCategoryImages()))
		mux.HandleFunc("GET /api/category-pictures/{name}", h.image(root.CategoryPictures(), root.OldCategoryPictures()))
		mux.HandleFunc("GET /api/covers/{name}", h.videoImage(root.Covers(), content.FileCover))
		mux.HandleFunc("GET /api/previews/{name}", h.videoImage(root.Previews(), content.FileTimeline))
		mux.HandleFunc("GET /api/clips/{name}", h.made(root.Clips(), content.FileClip, ".mp4", "video/mp4"))
		mux.HandleFunc("GET /api/clips-hd/{name}", h.made(root.ClipsHD(), content.FileClipHD, ".mp4", "video/mp4"))
	}
}

type handlers struct {
	store  store
	root   content.Root
	logger *slog.Logger
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
// A video not every browser plays is sent as its copy, when it is ready,
// unless the browser asks for the file itself (?original=1) because it
// can play it at its full quality. The file is only opened for reading
// (rule 1).
func (h handlers) stream(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
		return
	}
	name, _, err := h.store.played(r.Context(), id, h.root, r.URL.Query().Get("original") == "1")
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

// image serves the JPEG images FranzPLAY made in dir, with nothing in the
// folders of the videos: the pictures of the categories.
func (h handlers) image(dir, old string) http.HandlerFunc {
	newer, older := h.made(dir, "", ".jpg", "image/jpeg"), h.made(old, "", ".jpg", "image/jpeg")
	return func(w http.ResponseWriter, r *http.Request) {
		if content.Find(dir, old, r.PathValue("name")) == filepath.Join(dir, r.PathValue("name")) {
			newer(w, r)
			return
		}
		older(w, r)
	}
}

// videoImage serves a JPEG image of a video: its cover or its previews.
func (h handlers) videoImage(dir, inFolder string) http.HandlerFunc {
	return h.made(dir, inFolder, ".jpg", "image/jpeg")
}

// made serves the files FranzPLAY made, all ending in ext: images, or the
// clips that play on the cards. An address with a code is the file inFolder of
// the folder of a video; any other is a file of the old flat folder dir. Their
// addresses change with the content, so the browser may keep them for a year
// without asking again.
func (h handlers) made(dir, inFolder, ext, contentType string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		where := filepath.Join(dir, name)
		if code, ok := content.CodeOfAddress(name, ext); ok && inFolder != "" {
			where = h.root.FileIn(code, inFolder)
		} else if !validMadeName(name, ext) {
			respond.Error(w, r, h.logger, http.StatusNotFound, "file not found")
			return
		}
		file, err := os.Open(where)
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
		// private: these files are behind the login. A shared cache (a
		// proxy in front of FranzPLAY) must not hand them to strangers.
		w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
		if _, public := publicKey(r.Context()); public {
			// Through a public link the address stays the same when the
			// file changes, and the link can be revoked: always ask again.
			w.Header().Set("Cache-Control", "private, no-cache")
		}
		http.ServeContent(w, r, "", info.ModTime(), file)
	}
}
