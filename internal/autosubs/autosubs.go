// Package autosubs is the administrator's page for the subtitles that
// whisper writes: which videos have subtitles, asking whisper for new
// ones and their translations, following the work, deleting what was
// made. The work itself is the 'transcribe' job, in package media.
package autosubs

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/users"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// Languages tells which languages a translator knows; *translate.Client
// is one.
type Languages interface {
	Languages(ctx context.Context) ([]string, error)
}

// Options are the parts of the machine the page depends on.
type Options struct {
	DataDir    string
	Whisper    bool        // whisper.cpp and ffmpeg were found: subtitles can be made
	Translator Languages   // nil: no translator set, nothing is translated
	Downloader *Downloader // downloads the models; nil: none can be downloaded
}

// Routes adds the API of the page to mux, for administrators only:
//
//	GET    /api/admin/subtitles                     the videos and their subtitles (?q=&have=with|without&lang=&limit=&offset=)
//	GET    /api/admin/subtitles/setup               what this machine can do: whisper, models, translator
//	POST   /api/admin/subtitles/models/{name}       download a whisper model
//	PUT    /api/admin/subtitles/{id}                ask for subtitles {spoken, model, translate}
//	DELETE /api/admin/subtitles/{id}/request        take the request back
//	DELETE /api/admin/subtitles/{id}/made/{lang}    delete subtitles whisper made
//
// queued tells the job worker and the open pages that there is new work.
func Routes(db *sql.DB, opts Options, queued func(), logger *slog.Logger) func(mux *http.ServeMux) {
	p := page{db: db, opts: opts, queued: queued, logger: logger, now: time.Now, account: users.FromContext}
	return p.routes
}

func (p page) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/admin/subtitles", p.only(p.handleList))
	mux.HandleFunc("GET /api/admin/subtitles/setup", p.only(p.handleSetup))
	mux.HandleFunc("POST /api/admin/subtitles/models/{name}", p.only(p.handleDownload))
	mux.HandleFunc("PUT /api/admin/subtitles/{id}", p.only(p.handleAsk))
	mux.HandleFunc("DELETE /api/admin/subtitles/{id}/request", p.only(p.handleTakeBack))
	mux.HandleFunc("DELETE /api/admin/subtitles/{id}/made/{lang}", p.only(p.handleDelete))
}

type page struct {
	db      *sql.DB
	opts    Options
	queued  func()
	logger  *slog.Logger
	now     func() time.Time
	account func(context.Context) (users.Account, bool)
}

// only lets only administrators through.
func (p page) only(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		who, ok := p.account(r.Context())
		switch {
		case !ok:
			respond.Error(w, r, p.logger, http.StatusUnauthorized, "login required")
		case who.Role != users.Admin:
			respond.Error(w, r, p.logger, http.StatusForbidden, "administrators only")
		default:
			next(w, r)
		}
	}
}

// Setup is what this machine can do, so the page offers only that.
type Setup struct {
	Whisper bool     `json:"whisper"` // whisper.cpp is installed
	Models  []string `json:"models"`  // the models in the data folder: "small", "medium"
	// Translator says whether a translator is set; TranslatorError why it
	// does not answer, when it does not; TranslatorLanguages the languages
	// it knows.
	Translator          bool     `json:"translator"`
	TranslatorError     string   `json:"translatorError"`
	TranslatorLanguages []string `json:"translatorLanguages"`
	Languages           []string `json:"languages"`    // what can be asked: "it", "en"…
	ModelsFolder        string   `json:"modelsFolder"` // where the models go
	// Downloadable are the models FranzPLAY can download by itself, and
	// Download how the last download goes; null if none.
	Downloadable []Model   `json:"downloadable"`
	Download     *Download `json:"download"`
}

// translatorTimeout is how long the page waits for the translator.
const translatorTimeout = 5 * time.Second

func (p page) handleSetup(w http.ResponseWriter, r *http.Request) {
	models, err := media.Models(p.opts.DataDir)
	if err != nil {
		respond.InternalError(w, r, p.logger, err)
		return
	}
	folder, err := filepath.Abs(filepath.Join(p.opts.DataDir, media.WhisperDir))
	if err != nil {
		respond.InternalError(w, r, p.logger, err)
		return
	}
	s := Setup{Whisper: p.opts.Whisper, Models: models, Translator: p.opts.Translator != nil,
		TranslatorLanguages: []string{}, Languages: video.AutoLanguages, ModelsFolder: folder}
	if s.Models == nil {
		s.Models = []string{}
	}
	s.Downloadable = []Model{}
	if p.opts.Downloader != nil {
		s.Downloadable = Models
		s.Download = p.opts.Downloader.Status()
	}
	if p.opts.Translator != nil {
		ctx, cancel := context.WithTimeout(r.Context(), translatorTimeout)
		known, err := p.opts.Translator.Languages(ctx)
		cancel()
		if err != nil {
			p.logger.WarnContext(r.Context(), "translator does not answer", "error", err)
			s.TranslatorError = "Il traduttore non risponde: controlla che LibreTranslate sia acceso."
		} else {
			s.TranslatorLanguages = known
		}
	}
	respond.JSON(w, r, p.logger, http.StatusOK, s)
}

func (p page) handleDownload(w http.ResponseWriter, r *http.Request) {
	if p.opts.Downloader == nil {
		respond.Error(w, r, p.logger, http.StatusNotFound, "no downloads here")
		return
	}
	name := r.PathValue("name")
	switch err := p.opts.Downloader.Start(name); {
	case errors.Is(err, errUnknownModel):
		respond.Error(w, r, p.logger, http.StatusNotFound, err.Error())
	case errors.Is(err, errBusy):
		respond.Error(w, r, p.logger, http.StatusConflict, err.Error())
	case err != nil:
		respond.InternalError(w, r, p.logger, err)
	default:
		who, _ := p.account(r.Context())
		p.logger.InfoContext(r.Context(), "whisper model download started", "model", name, "by", who.Name)
		w.WriteHeader(http.StatusAccepted)
	}
}

// askBody is the body of PUT /api/admin/subtitles/{id}.
type askBody struct {
	Spoken    string   `json:"spoken"`    // "" = whisper guesses
	Model     string   `json:"model"`     // one of Setup.Models
	Translate []string `json:"translate"` // the other languages wanted
}

// errBadRequest is a request the page should never send.
var errBadRequest = errors.New("bad request")

// check controls a request once, at the door (rule 8).
func (p page) check(b askBody) error {
	if !p.opts.Whisper {
		return fmt.Errorf("%w: whisper is not installed", errBadRequest)
	}
	if b.Spoken != "" && !video.IsAutoLanguage(b.Spoken) {
		return fmt.Errorf("%w: unknown spoken language %q", errBadRequest, b.Spoken)
	}
	models, err := media.Models(p.opts.DataDir)
	if err != nil {
		return err
	}
	if !slices.Contains(models, b.Model) {
		return fmt.Errorf("%w: no model %q in the whisper folder", errBadRequest, b.Model)
	}
	if len(b.Translate) > 0 && p.opts.Translator == nil {
		return fmt.Errorf("%w: no translator set", errBadRequest)
	}
	for i, lang := range b.Translate {
		if !video.IsAutoLanguage(lang) || slices.Contains(b.Translate[:i], lang) {
			return fmt.Errorf("%w: bad language %q", errBadRequest, lang)
		}
	}
	return nil
}

func (p page) handleAsk(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		respond.Error(w, r, p.logger, http.StatusNotFound, "video not found")
		return
	}
	var b askBody
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&b); err != nil {
		respond.Error(w, r, p.logger, http.StatusBadRequest, `the body must be {"spoken": "", "model": "small", "translate": ["en"]}`)
		return
	}
	if err := p.check(b); errors.Is(err, errBadRequest) {
		respond.Error(w, r, p.logger, http.StatusBadRequest, err.Error())
		return
	} else if err != nil {
		respond.InternalError(w, r, p.logger, err)
		return
	}
	switch err := p.ask(r.Context(), id, b); {
	case errors.Is(err, errNotFound):
		respond.Error(w, r, p.logger, http.StatusNotFound, "video not found")
	case errors.Is(err, errMissing):
		respond.Error(w, r, p.logger, http.StatusConflict, err.Error())
	case err != nil:
		respond.InternalError(w, r, p.logger, err)
	default:
		who, _ := p.account(r.Context())
		p.logger.InfoContext(r.Context(), "automatic subtitles asked", "video", id, "model", b.Model,
			"spoken", b.Spoken, "translate", strings.Join(b.Translate, ","), "by", who.Name)
		p.queued()
		w.WriteHeader(http.StatusNoContent)
	}
}

// errNotFound means there is no such video, or no such subtitle.
var errNotFound = errors.New("not found")

// errMissing means the video's file is not where it was last seen.
var errMissing = errors.New("the video file is not in its folder")

// ask saves a request and puts the job in the queue.
func (p page) ask(ctx context.Context, id int64, b askBody) (err error) {
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("ask subtitles of video %d: %w", id, err)
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, tx.Rollback())
			return
		}
		err = tx.Commit()
	}()
	var missing bool
	err = tx.QueryRowContext(ctx, `SELECT missing_since IS NOT NULL FROM videos WHERE id = ?`, id).Scan(&missing)
	if errors.Is(err, sql.ErrNoRows) {
		return errNotFound
	}
	if err != nil {
		return fmt.Errorf("ask subtitles of video %d: %w", id, err)
	}
	if missing {
		return errMissing
	}
	now := p.now()
	if _, err := tx.ExecContext(ctx, `INSERT INTO subtitle_requests (video_id, spoken, model, langs, requested_at)
		VALUES (?, ?, ?, ?, ?) ON CONFLICT (video_id) DO UPDATE
		SET spoken = excluded.spoken, model = excluded.model, langs = excluded.langs,
		    stage = '', requested_at = excluded.requested_at`,
		id, b.Spoken, b.Model, strings.Join(b.Translate, ","), now.Unix()); err != nil {
		return fmt.Errorf("ask subtitles of video %d: %w", id, err)
	}
	return jobs.Enqueue(ctx, tx, id, jobs.Transcribe, false, now)
}

func (p page) handleTakeBack(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		respond.Error(w, r, p.logger, http.StatusNotFound, "request not found")
		return
	}
	switch err := p.takeBack(r.Context(), id); {
	case errors.Is(err, errNotFound):
		respond.Error(w, r, p.logger, http.StatusNotFound, "request not found")
	case err != nil:
		respond.InternalError(w, r, p.logger, err)
	default:
		p.queued()
		w.WriteHeader(http.StatusNoContent)
	}
}

// takeBack forgets a request and its job. A transcription already running
// goes on, but throws its work away when it ends.
func (p page) takeBack(ctx context.Context, id int64) (err error) {
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("take back subtitles of video %d: %w", id, err)
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, tx.Rollback())
			return
		}
		err = tx.Commit()
	}()
	res, err := tx.ExecContext(ctx, `DELETE FROM subtitle_requests WHERE video_id = ?`, id)
	if err != nil {
		return fmt.Errorf("take back subtitles of video %d: %w", id, err)
	}
	if n, err := res.RowsAffected(); err != nil {
		return fmt.Errorf("take back subtitles of video %d: %w", id, err)
	} else if n == 0 {
		return errNotFound
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM jobs WHERE video_id = ? AND kind = ?`, id, string(jobs.Transcribe)); err != nil {
		return fmt.Errorf("take back subtitles of video %d: %w", id, err)
	}
	return nil
}

func (p page) handleDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r.PathValue("id"))
	lang := r.PathValue("lang")
	if !ok || !validLang(lang) {
		respond.Error(w, r, p.logger, http.StatusNotFound, "subtitle not found")
		return
	}
	switch err := p.delete(r.Context(), id, lang); {
	case errors.Is(err, errNotFound):
		respond.Error(w, r, p.logger, http.StatusNotFound, "subtitle not found")
	case err != nil:
		respond.InternalError(w, r, p.logger, err)
	default:
		who, _ := p.account(r.Context())
		p.logger.InfoContext(r.Context(), "automatic subtitles deleted", "video", id, "lang", lang, "by", who.Name)
		w.WriteHeader(http.StatusNoContent)
	}
}

// delete forgets subtitles whisper made, then deletes their file from the
// data folder. Only files FranzPLAY made can go: never a file next to a
// video (rule 1).
func (p page) delete(ctx context.Context, id int64, lang string) error {
	var file string
	err := p.db.QueryRowContext(ctx, `DELETE FROM auto_subtitles WHERE video_id = ? AND lang = ? RETURNING file`,
		id, lang).Scan(&file)
	if errors.Is(err, sql.ErrNoRows) {
		return errNotFound
	}
	if err != nil {
		return fmt.Errorf("delete subtitles %s of video %d: %w", lang, id, err)
	}
	name := filepath.Join(p.opts.DataDir, media.AutoSubtitlesDir, filepath.Base(file))
	if err := os.Remove(name); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("delete subtitles %s of video %d: %w", lang, id, err)
	}
	return nil
}

// validLang accepts a language code as whisper writes it: "it", "haw".
func validLang(lang string) bool {
	if len(lang) < 2 || len(lang) > 3 {
		return false
	}
	for _, c := range lang {
		if c < 'a' || c > 'z' {
			return false
		}
	}
	return true
}

// parseID reads a video id from the address.
func parseID(s string) (int64, bool) {
	id, err := strconv.ParseInt(s, 10, 64)
	return id, err == nil && id > 0 && strconv.FormatInt(id, 10) == s
}
