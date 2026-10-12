package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// The administrator's changes to the catalog live here and in edit.go:
// hiding a video, asking for its information, cover and previews again,
// changing its title and category (edit.go), and choosing its cover
// (cover.go) and its clip (clip.go). Everything else in this package
// only reads.

// errFileMissing means the video's file was not found at the last scan.
var errFileMissing = errors.New("the video file is not in its folder")

// AdminVideo is a video as the administrator sees it: also the hidden ones
// and the ones whose file is not found, with where the file is.
type AdminVideo struct {
	Video
	Folder  string `json:"folder"` // the video folder it is in
	Path    string `json:"path"`   // inside the folder, with "/"
	Hidden  bool   `json:"hidden"`
	Missing bool   `json:"missing"` // not found at the last scan
	// What FranzPLAY found by itself, shown when the administrator
	// changes title or category, to put it back.
	FoundTitle    string `json:"foundTitle"`
	FoundCategory string `json:"foundCategory"`
	TitleSet      bool   `json:"titleSet"`    // the title is the administrator's
	CategorySet   bool   `json:"categorySet"` // the category is the administrator's
	// The cover the administrator chose: "image" uploaded, a "moment" of
	// the video (CoverSecond), or "" for the one FranzPLAY picks.
	CoverChoice string `json:"coverChoice"`
	CoverSecond *int64 `json:"coverSecond"`
	// The clip the administrator chose: a "video" uploaded, "none", or ""
	// for the one FranzPLAY makes.
	ClipChoice string `json:"clipChoice"`
	// The format inside the file, for the administrator's table: "h264",
	// "aac"; "" if not read yet. HasCopy tells that FranzPLAY made a copy
	// every browser plays.
	VideoCodec string `json:"videoCodec"`
	AudioCodec string `json:"audioCodec"`
	HasCopy    bool   `json:"hasCopy"`
}

// adminFilter narrows the administrator's list.
type adminFilter string

const (
	allVideos     adminFilter = ""
	hiddenVideos  adminFilter = "hidden"
	missingVideos adminFilter = "missing"
)

// AdminRoutes adds the administrator's video API to mux:
//
//	GET  /api/admin/videos                 every video (?q=&show=hidden|missing&limit=&offset=)
//	PUT  /api/admin/videos/{id}/hidden     hide or show again {hidden}
//	POST /api/admin/videos/{id}/refresh    read it again and remake cover and previews
//	PUT  /api/admin/videos/{id}/details    another title and category {title, category};
//	                                       null puts back the found one
//	PUT  /api/admin/videos/{id}/cover      an image as cover (the body is the image)
//	PUT  /api/admin/videos/{id}/cover-second  a moment of the video as cover {second}
//	DELETE /api/admin/videos/{id}/cover    back to the cover FranzPLAY picks
//	PUT  /api/admin/videos/{id}/clip       a video as the card's clip (the body is the video)
//	POST /api/admin/videos/{id}/clip/remake  back to the clip FranzPLAY makes, made again
//	DELETE /api/admin/videos/{id}/clip     no clip on the card
//
// changed tells the open pages the list of videos changed; queued tells
// the job worker (and the pages) that there is new work.
func AdminRoutes(db *sql.DB, dataDir string, changed, queued func(), logger *slog.Logger) func(mux *http.ServeMux) {
	a := admin{store: store{db: db}, dataDir: dataDir, changed: changed, queued: queued, logger: logger,
		now: time.Now, account: users.FromContext}
	return a.routes
}

type admin struct {
	store   store
	dataDir string // FranzPLAY's data folder, for the uploaded covers
	changed func()
	queued  func()
	logger  *slog.Logger
	now     func() time.Time
	account func(context.Context) (users.Account, bool)
}

func (a admin) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/admin/videos", a.only(a.handleList))
	mux.HandleFunc("PUT /api/admin/videos/{id}/hidden", a.only(a.handleHidden))
	mux.HandleFunc("POST /api/admin/videos/{id}/refresh", a.only(a.handleRefresh))
	mux.HandleFunc("PUT /api/admin/videos/{id}/details", a.only(a.handleDetails))
	mux.HandleFunc("PUT /api/admin/videos/{id}/cover", a.only(a.handleOwnCover))
	mux.HandleFunc("PUT /api/admin/videos/{id}/cover-second", a.only(a.handleCoverSecond))
	mux.HandleFunc("DELETE /api/admin/videos/{id}/cover", a.only(a.handleResetCover))
	mux.HandleFunc("PUT /api/admin/videos/{id}/clip", a.only(a.handleOwnClip))
	mux.HandleFunc("POST /api/admin/videos/{id}/clip/remake", a.only(a.handleRemakeClip))
	mux.HandleFunc("DELETE /api/admin/videos/{id}/clip", a.only(a.handleNoClip))
}

// only lets only administrators through.
func (a admin) only(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		who, ok := a.account(r.Context())
		switch {
		case !ok:
			respond.Error(w, r, a.logger, http.StatusUnauthorized, "login required")
		case who.Role != users.Admin:
			respond.Error(w, r, a.logger, http.StatusForbidden, "administrators only")
		default:
			next(w, r)
		}
	}
}

// parseAdminQuery checks the parameters of GET /api/admin/videos: the
// ones of the normal list, except category, plus show.
func parseAdminQuery(values url.Values) (listQuery, adminFilter, error) {
	q, err := parseListQuery(values)
	if err != nil {
		return listQuery{}, "", err
	}
	q.category = ""
	switch f := adminFilter(values.Get("show")); f {
	case allVideos, hiddenVideos, missingVideos:
		return q, f, nil
	default:
		return listQuery{}, "", fmt.Errorf(`%w: show must be "hidden" or "missing"`, errBadQuery)
	}
}

type adminList struct {
	Videos []AdminVideo `json:"videos"`
	Total  int          `json:"total"`
}

func (a admin) handleList(w http.ResponseWriter, r *http.Request) {
	q, filter, err := parseAdminQuery(r.URL.Query())
	if err != nil {
		respond.Error(w, r, a.logger, http.StatusBadRequest, err.Error())
		return
	}
	videos, total, err := a.store.adminList(r.Context(), q, filter)
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	respond.JSON(w, r, a.logger, http.StatusOK, adminList{Videos: videos, Total: total})
}

func (a admin) handleHidden(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		respond.Error(w, r, a.logger, http.StatusNotFound, errNotFound.Error())
		return
	}
	var req struct {
		Hidden *bool `json:"hidden"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil || req.Hidden == nil {
		respond.Error(w, r, a.logger, http.StatusBadRequest, `the body must be {"hidden": true} or {"hidden": false}`)
		return
	}
	err := a.store.setHidden(r.Context(), id, *req.Hidden, a.now())
	if errors.Is(err, errNotFound) {
		respond.Error(w, r, a.logger, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	who, _ := a.account(r.Context())
	a.logger.InfoContext(r.Context(), "video visibility changed", "video", id, "hidden", *req.Hidden, "by", who.Name)
	a.changed()
	w.WriteHeader(http.StatusNoContent)
}

func (a admin) handleRefresh(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		respond.Error(w, r, a.logger, http.StatusNotFound, errNotFound.Error())
		return
	}
	switch err := a.store.refresh(r.Context(), id, a.now()); {
	case errors.Is(err, errNotFound):
		respond.Error(w, r, a.logger, http.StatusNotFound, err.Error())
	case errors.Is(err, errFileMissing):
		respond.Error(w, r, a.logger, http.StatusConflict, err.Error())
	case err != nil:
		respond.InternalError(w, r, a.logger, err)
	default:
		a.queued()
		w.WriteHeader(http.StatusNoContent)
	}
}

// adminList returns a page of every video, hidden and missing ones too,
// newest first, and how many match in total.
func (s store) adminList(ctx context.Context, q listQuery, filter adminFilter) (_ []AdminVideo, total int, err error) {
	where := `1`
	args := []any{}
	switch filter {
	case hiddenVideos:
		where = `v.hidden_at IS NOT NULL`
	case missingVideos:
		where = `v.missing_since IS NOT NULL`
	}
	for _, w := range q.words {
		where += ` AND (v.shown_title LIKE ? ESCAPE '\' OR v.category LIKE ? ESCAPE '\' OR v.path LIKE ? ESCAPE '\')`
		p := likePattern(w)
		args = append(args, p, p, p)
	}
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM videos v WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count videos: %w", err)
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT `+videoColumns+`, l.path, v.path, v.hidden_at IS NOT NULL, v.missing_since IS NOT NULL,
		       coalesce(v.details_title, v.online_title, v.title), v.folder_category,
		       v.admin_title IS NOT NULL, v.admin_category IS NOT NULL,
		       v.own_cover IS NOT NULL, v.cover_second, v.own_clip IS NOT NULL, v.no_clip,
		       coalesce(v.video_codec, ''), coalesce(v.audio_codec, ''), v.converted IS NOT NULL
		FROM videos v JOIN libraries l ON l.id = v.library_id
		WHERE `+where+`
		ORDER BY v.added_at DESC, v.id DESC LIMIT ? OFFSET ?`, append(args, q.limit, q.offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("list videos: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := []AdminVideo{}
	for rows.Next() {
		var av AdminVideo
		var ownCover, ownClip, noClip bool
		var second sql.NullInt64
		av.Video, err = scanVideo(moreColumns{rows, []any{&av.Folder, &av.Path, &av.Hidden, &av.Missing,
			&av.FoundTitle, &av.FoundCategory, &av.TitleSet, &av.CategorySet, &ownCover, &second, &ownClip, &noClip,
			&av.VideoCodec, &av.AudioCodec, &av.HasCopy}})
		if err != nil {
			return nil, 0, fmt.Errorf("list videos: %w", err)
		}
		switch {
		case ownCover:
			av.CoverChoice = "image"
		case second.Valid:
			av.CoverChoice = "moment"
			av.CoverSecond = &second.Int64
		}
		switch {
		case ownClip:
			av.ClipChoice = "video"
		case noClip:
			av.ClipChoice = "none"
		}
		out = append(out, av)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("list videos: %w", err)
	}
	return out, total, nil
}

// setHidden hides a video, or shows it again.
func (s store) setHidden(ctx context.Context, id int64, hidden bool, now time.Time) error {
	var at any // NULL: shown
	if hidden {
		at = now.Unix()
	}
	// COALESCE keeps the first time a video was hidden.
	res, err := s.db.ExecContext(ctx, `UPDATE videos SET hidden_at = CASE WHEN ? IS NULL THEN NULL
		ELSE COALESCE(hidden_at, ?) END WHERE id = ?`, at, at, id)
	if err != nil {
		return fmt.Errorf("hide video %d: %w", id, err)
	}
	if n, err := res.RowsAffected(); err != nil {
		return fmt.Errorf("hide video %d: %w", id, err)
	} else if n == 0 {
		return errNotFound
	}
	return nil
}

// refresh asks the job queue to read the video again and remake its cover
// and previews, as if it were new.
func (s store) refresh(ctx context.Context, id int64, now time.Time) (err error) {
	var missing bool
	err = s.db.QueryRowContext(ctx, `SELECT missing_since IS NOT NULL FROM videos WHERE id = ?`, id).Scan(&missing)
	if errors.Is(err, sql.ErrNoRows) {
		return errNotFound
	}
	if err != nil {
		return fmt.Errorf("refresh video %d: %w", id, err)
	}
	if missing {
		return errFileMissing
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("refresh video %d: %w", id, err)
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, tx.Rollback())
			return
		}
		err = tx.Commit()
	}()
	for _, k := range []jobs.Kind{jobs.Probe, jobs.Details, jobs.Online, jobs.Cover, jobs.Preview, jobs.Clip, jobs.Tracks, jobs.Convert} {
		if err := jobs.Enqueue(ctx, tx, id, k, false, now); err != nil {
			return err
		}
	}
	return nil
}
