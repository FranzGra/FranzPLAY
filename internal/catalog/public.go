package catalog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"path/filepath"
	"strconv"

	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/sharing"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// A public link lets anybody, even without an account, watch one video:
// the one whose key is in the address, and nothing else. Its addresses
// live under /api/public/{key}/ and the login does not guard them; every
// query they make looks the video up by the key, never by an id from the
// address, so a guest cannot reach another video, a list or a file of
// FranzPLAY's own.

// publicWatchable says whether a video is the one of a public link: the
// key is still its link, its creator may still share in public, and the
// video is on the disk and not hidden. Its one argument is the key.
const publicWatchable = `(v.missing_since IS NULL AND v.hidden_at IS NULL AND v.id = (
	SELECT p.video_id FROM public_links p JOIN users u ON u.id = p.created_by
	WHERE p.token = ? AND (u.role = 'admin' OR u.can_share_public)))`

type publicKeyCtx struct{}

// withPublicKey marks a request as coming through the public link key.
func withPublicKey(ctx context.Context, key string) context.Context {
	return context.WithValue(ctx, publicKeyCtx{}, key)
}

// publicKey returns the key of the public link the request came through.
func publicKey(ctx context.Context) (string, bool) {
	k, ok := ctx.Value(publicKeyCtx{}).(string)
	return k, ok
}

// opens is the condition for the video a request may open, with opener
// as its one argument: the person's videos, or only the video of the
// public link the request came through.
func opens(ctx context.Context) string {
	if _, ok := publicKey(ctx); ok {
		return publicWatchable
	}
	return watchable
}

func opener(ctx context.Context) any {
	if k, ok := publicKey(ctx); ok {
		return k
	}
	return viewer(ctx)
}

// videoBase is the start of the addresses of a video's files for this
// request: by id behind the login, by key through a public link.
func videoBase(ctx context.Context, id int64) string {
	if k, ok := publicKey(ctx); ok {
		return "/api/public/" + k
	}
	return "/api/videos/" + strconv.FormatInt(id, 10)
}

// PublicVideo is what a guest sees of the video of a public link: enough
// to play it, nothing about the rest of FranzPLAY.
type PublicVideo struct {
	Title       string   `json:"title"`
	Duration    *int64   `json:"duration"`
	Width       *int     `json:"width"`
	Height      *int     `json:"height"`
	Cover       *string  `json:"cover"`
	Preview     *Preview `json:"preview"`
	Playable    bool     `json:"playable"`
	FileType    string   `json:"fileType"`
	Copy        bool     `json:"copy"`
	Format      string   `json:"format"`
	Author      string   `json:"author"`
	PublishedOn *string  `json:"publishedOn"`
	Description *string  `json:"description,omitempty"`
	Owner       string   `json:"owner"`  // the name of who uploaded it; "" = the site's own video
	Stream      string   `json:"stream"` // the address of the video file
	// VideoID is the id of the video only for a logged-in person who could
	// open it anyway: the interface then shows its usual page. Guests and
	// the others never learn it.
	VideoID *int64 `json:"videoId,omitempty"`
}

// PublicRoutes adds the addresses of the public links, open without login:
//
//	GET /api/public/{key}                       the video
//	GET /api/public/{key}/stream                its file, with jumps (Range); ?original=1 as for /api/videos
//	GET /api/public/{key}/subtitles             its subtitles
//	GET /api/public/{key}/subtitles/{sub}       one subtitle
//	GET /api/public/{key}/cover                 its cover
//	GET /api/public/{key}/preview               the frames over its timeline
func PublicRoutes(db *sql.DB, dataDir string, logger *slog.Logger) func(mux *http.ServeMux) {
	h := handlers{store: store{db: db}, subtitlesDir: filepath.Join(dataDir, media.SubtitlesDir),
		autoSubtitlesDir: filepath.Join(dataDir, media.AutoSubtitlesDir),
		convertedDir:     filepath.Join(dataDir, media.ConvertedDir), logger: logger}
	covers := h.image(filepath.Join(dataDir, media.CoversDir))
	previews := h.image(filepath.Join(dataDir, media.PreviewsDir))
	return func(mux *http.ServeMux) {
		mux.HandleFunc("GET /api/public/{key}", h.public(h.publicVideo))
		mux.HandleFunc("GET /api/public/{key}/stream", h.public(h.stream))
		mux.HandleFunc("GET /api/public/{key}/subtitles", h.public(h.subtitles))
		mux.HandleFunc("GET /api/public/{key}/subtitles/{sub}", h.public(func(w http.ResponseWriter, r *http.Request) {
			r.SetPathValue("key", r.PathValue("sub"))
			h.subtitle(w, r)
		}))
		mux.HandleFunc("GET /api/public/{key}/cover", h.public(h.publicImage("cover", covers)))
		mux.HandleFunc("GET /api/public/{key}/preview", h.public(h.publicImage("preview", previews)))
	}
}

// public finds the video of the key in the address and hands the request
// on as if it asked for that video by id, marked as public: from there
// every query only opens that one video. A wrong key answers 404, the
// same as a revoked one, so nobody learns which keys once existed.
func (h handlers) public(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := r.PathValue("key")
		if !sharing.ValidKey(key) {
			respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
			return
		}
		ctx := withPublicKey(r.Context(), key)
		var id int64
		err := h.store.db.QueryRowContext(ctx, `SELECT v.id FROM videos v WHERE `+publicWatchable, key).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
			return
		}
		if err != nil {
			respond.InternalError(w, r, h.logger, fmt.Errorf("find public link: %w", err))
			return
		}
		r = r.WithContext(ctx)
		r.SetPathValue("id", strconv.FormatInt(id, 10))
		next(w, r)
	}
}

func (h handlers) publicVideo(w http.ResponseWriter, r *http.Request) {
	id, _ := parseID(r.PathValue("id"))
	v, err := h.store.get(r.Context(), id)
	if errors.Is(err, errNotFound) {
		respond.Error(w, r, h.logger, http.StatusNotFound, "video not found")
		return
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	base := videoBase(r.Context(), id)
	p := PublicVideo{Title: v.Title, Duration: v.Duration, Width: v.Width, Height: v.Height,
		Playable: v.Playable, FileType: v.FileType, Copy: v.Copy, Format: v.Format,
		Author: v.Author, PublishedOn: v.PublishedOn, Description: v.Description, Stream: base + "/stream"}
	if v.Cover != nil {
		address := base + "/cover"
		p.Cover = &address
	}
	if v.Preview != nil {
		preview := *v.Preview
		preview.Src = base + "/preview"
		p.Preview = &preview
	}
	if v.Owner != nil {
		p.Owner = v.Owner.Name
	}
	if a, ok := users.FromContext(r.Context()); ok {
		var one int
		err := h.store.db.QueryRowContext(r.Context(), `SELECT 1 FROM videos v WHERE v.id = ? AND `+watchable, id, a.ID).Scan(&one)
		switch {
		case err == nil:
			p.VideoID = &id
		case !errors.Is(err, sql.ErrNoRows):
			respond.InternalError(w, r, h.logger, fmt.Errorf("read video %d: %w", id, err))
			return
		}
	}
	h.logger.InfoContext(r.Context(), "public link opened", "video", id, "address", r.RemoteAddr)
	w.Header().Set("Cache-Control", "no-store")
	respond.JSON(w, r, h.logger, http.StatusOK, p)
}

// publicImage serves the cover or the preview of the video of the link,
// named in the database: the address names no file.
func (h handlers) publicImage(column string, serve http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, _ := parseID(r.PathValue("id"))
		key, _ := publicKey(r.Context())
		var name sql.NullString
		// column is one of two constants, never from the request.
		err := h.store.db.QueryRowContext(r.Context(), `SELECT v.`+column+` FROM videos v WHERE v.id = ? AND `+publicWatchable,
			id, key).Scan(&name)
		if errors.Is(err, sql.ErrNoRows) || (err == nil && !name.Valid) {
			respond.Error(w, r, h.logger, http.StatusNotFound, "file not found")
			return
		}
		if err != nil {
			respond.InternalError(w, r, h.logger, fmt.Errorf("find public %s: %w", column, err))
			return
		}
		r.SetPathValue("name", name.String)
		serve(w, r)
	}
}
