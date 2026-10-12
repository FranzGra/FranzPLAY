package catalog

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// maxSubtitleSize is the largest subtitle file served. A two-hour film
// has about 100 KB of subtitles: anything much bigger is not a subtitle.
const maxSubtitleSize = 5 << 20

// subtitleTrack is one subtitle in GET /api/videos/{id}/subtitles.
type subtitleTrack struct {
	Key   string `json:"key"`
	Lang  string `json:"lang"`  // for the browser: "it", "en-US", "" = unknown
	Label string `json:"label"` // for people: "Italiano"
	Src   string `json:"src"`
}

// findSubtitles lists the subtitle files next to a video. The folder is
// only read (rule 1).
func (h handlers) findSubtitles(w http.ResponseWriter, r *http.Request) (videoFile string, subs []video.Subtitle, ok bool) {
	id, valid := parseID(r.PathValue("id"))
	if !valid {
		respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
		return "", nil, false
	}
	name, err := h.store.file(r.Context(), id)
	if errors.Is(err, errNotFound) {
		respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
		return "", nil, false
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return "", nil, false
	}
	entries, err := os.ReadDir(filepath.Dir(name))
	if errors.Is(err, fs.ErrNotExist) {
		return name, nil, true // folder gone: the next scan will notice
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, fmt.Errorf("read video folder: %w", err))
		return "", nil, false
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.Type().IsRegular() {
			names = append(names, e.Name())
		}
	}
	return name, video.FindSubtitles(name, names), true
}

func (h handlers) subtitles(w http.ResponseWriter, r *http.Request) {
	_, subs, ok := h.findSubtitles(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	tracks := make([]subtitleTrack, 0, len(subs))
	for _, s := range subs {
		tracks = append(tracks, subtitleTrack{
			Key:   s.Key,
			Lang:  video.LangCode(s.Lang),
			Label: video.SubtitleLabel(s.Lang),
			Src:   "/api/videos/" + id + "/subtitles/" + url.PathEscape(s.Key),
		})
	}
	respond.JSON(w, r, h.logger, http.StatusOK, tracks)
}

// subtitle sends one subtitle file as WebVTT. The key must be one of the
// subtitles found next to the video: nothing else on the disk can be asked.
func (h handlers) subtitle(w http.ResponseWriter, r *http.Request) {
	videoFile, subs, ok := h.findSubtitles(w, r)
	if !ok {
		return
	}
	key := r.PathValue("key")
	var found *video.Subtitle
	for i := range subs {
		if subs[i].Key == key {
			found = &subs[i]
		}
	}
	if found == nil {
		respond.Error(w, r, h.logger, http.StatusNotFound, "subtitle not found")
		return
	}
	name := strings.TrimSuffix(videoFile, filepath.Ext(videoFile)) + "." + found.Key
	data, err := readSmall(name, maxSubtitleSize)
	if errors.Is(err, fs.ErrNotExist) {
		respond.Error(w, r, h.logger, http.StatusNotFound, "subtitle not found")
		return
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	body := video.ToWebVTT(video.DecodeSubtitleText(data), found.Format)
	w.Header().Set("Content-Type", "text/vtt; charset=utf-8")
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.Header().Set("Cache-Control", "private, no-cache")
	if _, err := io.WriteString(w, body); err != nil {
		h.logger.DebugContext(r.Context(), "send subtitle", "error", err)
	}
}

// errTooBig means a file is larger than allowed.
var errTooBig = errors.New("file too big")

// readSmall reads a whole file, refusing one larger than limit bytes.
func readSmall(name string, limit int64) (_ []byte, err error) {
	f, err := os.Open(name)
	if err != nil {
		return nil, fmt.Errorf("open subtitle: %w", err)
	}
	defer func() {
		if closeErr := f.Close(); closeErr != nil {
			err = errors.Join(err, fmt.Errorf("close subtitle: %w", closeErr))
		}
	}()
	data, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, fmt.Errorf("read subtitle: %w", err)
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("subtitle %s: %w", filepath.Base(name), errTooBig)
	}
	return data, nil
}
