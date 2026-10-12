package catalog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"strconv"

	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// Remuxer plays a video with another of its sound tracks: media.Remuxer,
// replaced only in tests.
type Remuxer interface {
	StartOf(ctx context.Context, file string, at float64) (float64, error)
	Stream(ctx context.Context, w io.Writer, file string, audio video.EmbeddedAudio, at float64) error
}

// maxSeconds is the latest time accepted in an address: two days.
const maxSeconds = 2 * 24 * 60 * 60

// audioTrack is one sound track in GET /api/videos/{id}/audio.
type audioTrack struct {
	Stream  int    `json:"stream"`
	Lang    string `json:"lang"`  // for the browser: "it", "" = unknown
	Label   string `json:"label"` // for people: "Italiano"
	Default bool   `json:"default"`
}

// audioStart is the answer of GET /api/videos/{id}/audio/{stream}.
type audioStart struct {
	Start float64 `json:"start"` // where the video at Src really begins, in seconds
	Src   string  `json:"src"`
}

type audioHandlers struct {
	store  store
	remux  Remuxer // nil when ffmpeg is not installed
	logger *slog.Logger
}

// AudioRoutes adds the API to choose the sound track of a video:
//
//	GET /api/videos/{id}/audio                    the sound tracks, when there is a choice
//	GET /api/videos/{id}/audio/{stream}?at=S      where to start playing it to reach S seconds
//	GET /api/videos/{id}/audio/{stream}/stream    the video with that sound (?at=)
//
// Without remux (no ffmpeg), there is never a choice.
func AudioRoutes(db *sql.DB, remux Remuxer, logger *slog.Logger) func(mux *http.ServeMux) {
	h := audioHandlers{store: store{db: db}, remux: remux, logger: logger}
	return func(mux *http.ServeMux) {
		mux.HandleFunc("GET /api/videos/{id}/audio", h.list)
		mux.HandleFunc("GET /api/videos/{id}/audio/{stream}", h.start)
		mux.HandleFunc("GET /api/videos/{id}/audio/{stream}/stream", h.stream)
	}
}

// list answers the sound tracks of a video. With one track or none there
// is nothing to choose: the list is empty.
func (h audioHandlers) list(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
		return
	}
	if _, err := h.store.file(r.Context(), id); err != nil {
		h.fail(w, r, err)
		return
	}
	tracks := []audioTrack{}
	if h.remux != nil {
		all, err := h.store.audio(r.Context(), id)
		if err != nil {
			respond.InternalError(w, r, h.logger, err)
			return
		}
		if len(all) > 1 {
			for i, a := range all {
				tracks = append(tracks, audioTrack{
					Stream: a.Stream, Lang: video.LangCode(a.Lang), Label: a.Label(i + 1), Default: a.Default,
				})
			}
		}
	}
	respond.JSON(w, r, h.logger, http.StatusOK, tracks)
}

// track finds the video and the sound track of the address; it answers
// itself when one is not there.
func (h audioHandlers) track(w http.ResponseWriter, r *http.Request) (string, video.EmbeddedAudio, bool) {
	if h.remux == nil {
		respond.Error(w, r, h.logger, http.StatusNotFound, "choosing the sound needs ffmpeg")
		return "", video.EmbeddedAudio{}, false
	}
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
		return "", video.EmbeddedAudio{}, false
	}
	stream, err := strconv.Atoi(r.PathValue("stream"))
	if err != nil || stream < 0 {
		respond.Error(w, r, h.logger, http.StatusNotFound, "sound track not found")
		return "", video.EmbeddedAudio{}, false
	}
	file, err := h.store.file(r.Context(), id)
	if err != nil {
		h.fail(w, r, err)
		return "", video.EmbeddedAudio{}, false
	}
	all, err := h.store.audio(r.Context(), id)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return "", video.EmbeddedAudio{}, false
	}
	for _, a := range all {
		if a.Stream == stream {
			return file, a, true
		}
	}
	respond.Error(w, r, h.logger, http.StatusNotFound, "sound track not found")
	return "", video.EmbeddedAudio{}, false
}

// seconds reads a time in seconds from the query; it answers itself
// when it is not one.
func (h audioHandlers) seconds(w http.ResponseWriter, r *http.Request, name string) (float64, bool) {
	q := r.URL.Query().Get(name)
	if q == "" {
		return 0, true
	}
	t, err := strconv.ParseFloat(q, 64)
	if err != nil || math.IsNaN(t) || t < 0 || t > maxSeconds {
		respond.Error(w, r, h.logger, http.StatusBadRequest, name+" must be a number of seconds")
		return 0, false
	}
	return t, true
}

func (h audioHandlers) start(w http.ResponseWriter, r *http.Request) {
	file, audio, ok := h.track(w, r)
	if !ok {
		return
	}
	at, ok := h.seconds(w, r, "at")
	if !ok {
		return
	}
	start, err := h.remux.StartOf(r.Context(), file, at)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	src := fmt.Sprintf("/api/videos/%s/audio/%d/stream?at=%s",
		r.PathValue("id"), audio.Stream, strconv.FormatFloat(at, 'f', -1, 64))
	respond.JSON(w, r, h.logger, http.StatusOK, audioStart{Start: start, Src: src})
}

func (h audioHandlers) stream(w http.ResponseWriter, r *http.Request) {
	file, audio, ok := h.track(w, r)
	if !ok {
		return
	}
	at, ok := h.seconds(w, r, "at")
	if !ok {
		return
	}
	// The answer starts only once ffmpeg writes: a busy machine can still
	// say so with a proper error.
	out := &lazyHeader{w: w, header: func() {
		w.Header().Set("Content-Type", "video/mp4")
		w.Header().Set("Cache-Control", "no-store")
	}}
	err := h.remux.Stream(r.Context(), out, file, audio, at)
	switch {
	case err == nil:
	case errors.Is(err, media.ErrBusy):
		w.Header().Set("Retry-After", "10")
		respond.Error(w, r, h.logger, http.StatusServiceUnavailable, err.Error())
	case out.started:
		// Half the video is already sent: all that is left is to say why.
		h.logger.ErrorContext(r.Context(), "play with another sound track", "error", err)
	default:
		respond.InternalError(w, r, h.logger, err)
	}
}

// lazyHeader sets the headers just before the first bytes go out.
type lazyHeader struct {
	w       io.Writer
	header  func()
	started bool
}

func (l *lazyHeader) Write(p []byte) (int, error) {
	if !l.started {
		l.started = true
		l.header()
	}
	return l.w.Write(p)
}

// fail answers a video that cannot be found.
func (h audioHandlers) fail(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, errNotFound) {
		respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
		return
	}
	respond.InternalError(w, r, h.logger, err)
}
