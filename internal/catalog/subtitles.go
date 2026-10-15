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
func (h handlers) findSubtitles(w http.ResponseWriter, r *http.Request) (id int64, videoFile string, subs []video.Subtitle, ok bool) {
	id, valid := parseID(r.PathValue("id"))
	if !valid {
		respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
		return 0, "", nil, false
	}
	name, err := h.store.file(r.Context(), id)
	if errors.Is(err, errNotFound) {
		respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
		return 0, "", nil, false
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return 0, "", nil, false
	}
	entries, err := os.ReadDir(filepath.Dir(name))
	if errors.Is(err, fs.ErrNotExist) {
		return id, name, nil, true // folder gone: the next scan will notice
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, fmt.Errorf("read video folder: %w", err))
		return 0, "", nil, false
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.Type().IsRegular() {
			names = append(names, e.Name())
		}
	}
	return id, name, video.FindSubtitles(name, names), true
}

// insidePrefix starts the key of a subtitle inside the video file:
// "inside-2" is the file's stream 2. A subtitle next to the video always
// ends with .srt or .vtt, so the two never mix.
const insidePrefix = "inside-"

// insideStream reads the stream of a key made with insidePrefix.
func insideStream(key string) (int, bool) {
	n, found := strings.CutPrefix(key, insidePrefix)
	if !found {
		return 0, false
	}
	stream, err := strconv.Atoi(n)
	return stream, err == nil && stream >= 0 && strconv.Itoa(stream) == n
}

// autoPrefix starts the key of a subtitle written by whisper, or
// translated: "auto-it".
const autoPrefix = "auto-"

// subtitles lists the subtitles next to the video first, since someone
// put them there on purpose, then the ones inside the file, then the
// ones whisper wrote.
func (h handlers) subtitles(w http.ResponseWriter, r *http.Request) {
	videoID, _, subs, ok := h.findSubtitles(w, r)
	if !ok {
		return
	}
	base := videoBase(r.Context(), videoID)
	inside, err := h.store.embedded(r.Context(), videoID)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	auto, err := h.store.auto(r.Context(), videoID)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	tracks := make([]subtitleTrack, 0, len(subs)+len(inside)+len(auto))
	for _, s := range subs {
		tracks = append(tracks, subtitleTrack{
			Key:   s.Key,
			Lang:  video.LangCode(s.Lang),
			Label: video.SubtitleLabel(s.Lang),
			Src:   base + "/subtitles/" + url.PathEscape(s.Key),
		})
	}
	for _, s := range inside {
		key := insidePrefix + strconv.Itoa(s.Stream)
		tracks = append(tracks, subtitleTrack{
			Key:   key,
			Lang:  video.LangCode(s.Lang),
			Label: s.Label(),
			Src:   base + "/subtitles/" + key,
		})
	}
	for _, a := range auto {
		key := autoPrefix + a.lang
		tracks = append(tracks, subtitleTrack{
			Key:   key,
			Lang:  a.lang,
			Label: video.SubtitleLabel(a.lang) + " (automatici)",
			Src:   base + "/subtitles/" + key,
		})
	}
	respond.JSON(w, r, h.logger, http.StatusOK, tracks)
}

// subtitle sends one subtitle file as WebVTT. The key must be one of the
// subtitles found next to the video or copied from inside it: nothing
// else on the disk can be asked.
func (h handlers) subtitle(w http.ResponseWriter, r *http.Request) {
	if stream, ok := insideStream(r.PathValue("key")); ok {
		h.insideSubtitle(w, r, stream)
		return
	}
	if lang, ok := strings.CutPrefix(r.PathValue("key"), autoPrefix); ok {
		h.autoSubtitle(w, r, lang)
		return
	}
	_, videoFile, subs, ok := h.findSubtitles(w, r)
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
	h.sendVTT(w, r, video.ToWebVTT(video.DecodeSubtitleText(data), found.Format))
}

// insideSubtitle sends the copy of a subtitle inside the video file,
// already WebVTT.
func (h handlers) insideSubtitle(w http.ResponseWriter, r *http.Request, stream int) {
	id, valid := parseID(r.PathValue("id"))
	if !valid {
		respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
		return
	}
	name, err := h.store.embeddedFile(r.Context(), id, stream)
	if errors.Is(err, errNotFound) {
		respond.Error(w, r, h.logger, http.StatusNotFound, "subtitle not found")
		return
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	data, err := readSmall(filepath.Join(h.subtitlesDir, filepath.Base(name)), maxSubtitleSize)
	if errors.Is(err, fs.ErrNotExist) {
		respond.Error(w, r, h.logger, http.StatusNotFound, "subtitle not found")
		return
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	h.sendVTT(w, r, string(data))
}

// autoSubtitle sends a subtitle written by whisper, already WebVTT.
func (h handlers) autoSubtitle(w http.ResponseWriter, r *http.Request, lang string) {
	id, valid := parseID(r.PathValue("id"))
	if !valid {
		respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
		return
	}
	name, err := h.store.autoFile(r.Context(), id, lang)
	if errors.Is(err, errNotFound) {
		respond.Error(w, r, h.logger, http.StatusNotFound, "subtitle not found")
		return
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	data, err := readSmall(filepath.Join(h.autoSubtitlesDir, filepath.Base(name)), maxSubtitleSize)
	if errors.Is(err, fs.ErrNotExist) {
		respond.Error(w, r, h.logger, http.StatusNotFound, "subtitle not found")
		return
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	h.sendVTT(w, r, string(data))
}

// sendVTT answers with a subtitle in WebVTT.
func (h handlers) sendVTT(w http.ResponseWriter, r *http.Request, body string) {
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
