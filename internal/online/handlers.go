package online

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// Routes adds the API of the sources on the internet, for administrators:
//
//	GET /api/online            which sources are on, and which keys are saved
//	PUT /api/online            turn them on or off {youtube, tmdb}
//	PUT /api/online/tmdb-key   save TMDB's key {key}, after TMDB said it is valid
//
// A key is never sent back: the answers only say if there is one.
// newJobs is called when the change put work in the queue.
func Routes(db *sql.DB, newJobs func(), logger *slog.Logger) func(mux *http.ServeMux) {
	a := api{db: db, newJobs: newJobs, logger: logger, now: time.Now, account: users.FromContext,
		tmdb: newTMDB(&http.Client{Timeout: askTimeout})}
	return func(mux *http.ServeMux) {
		mux.HandleFunc("GET /api/online", a.only(a.handleGet))
		mux.HandleFunc("PUT /api/online", a.only(a.handlePut))
		mux.HandleFunc("PUT /api/online/tmdb-key", a.only(a.handleTMDBKey))
	}
}

type api struct {
	db      *sql.DB
	newJobs func()
	logger  *slog.Logger
	now     func() time.Time
	account func(context.Context) (users.Account, bool)
	tmdb    tmdb
}

// status is what the administrator sees of the settings.
type status struct {
	Sources
	TMDBKey bool `json:"tmdbKey"` // a key for TMDB is saved
}

func statusOf(s settings) status {
	return status{Sources: s.Sources, TMDBKey: s.tmdbKey != ""}
}

// only lets only administrators through.
func (a api) only(next http.HandlerFunc) http.HandlerFunc {
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

func (a api) handleGet(w http.ResponseWriter, r *http.Request) {
	s, err := loadSettings(r.Context(), a.db)
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	respond.JSON(w, r, a.logger, http.StatusOK, statusOf(s))
}

func (a api) handlePut(w http.ResponseWriter, r *http.Request) {
	var next Sources
	if !decode(w, r, &next) {
		respond.Error(w, r, a.logger, http.StatusBadRequest, "the request is not valid JSON with the expected fields")
		return
	}
	s, err := loadSettings(r.Context(), a.db)
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	if next.TMDB && s.tmdbKey == "" {
		respond.Error(w, r, a.logger, http.StatusConflict, "TMDB needs its key first")
		return
	}
	turnedOn := (next.YouTube && !s.YouTube) || (next.TMDB && !s.TMDB)
	if err := a.change(r.Context(), turnedOn, func(tx *sql.Tx) error {
		return saveSources(r.Context(), tx, next)
	}); err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	who, _ := a.account(r.Context())
	a.logger.InfoContext(r.Context(), "online sources changed", "youtube", next.YouTube, "tmdb", next.TMDB, "by", who.Name)
	s.Sources = next
	respond.JSON(w, r, a.logger, http.StatusOK, statusOf(s))
}

func (a api) handleTMDBKey(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Key string `json:"key"`
	}
	if !decode(w, r, &in) {
		respond.Error(w, r, a.logger, http.StatusBadRequest, "the request is not valid JSON with the expected fields")
		return
	}
	key := strings.TrimSpace(in.Key)
	if !validTMDBKey(key) {
		respond.Error(w, r, a.logger, http.StatusBadRequest, "this is not a TMDB key")
		return
	}
	switch err := a.tmdb.checkKey(r.Context(), key); {
	case errors.Is(err, errKeyRefused):
		respond.Error(w, r, a.logger, http.StatusUnprocessableEntity, "TMDB refused the key")
		return
	case err != nil:
		a.logger.WarnContext(r.Context(), "tmdb key not checked", "err", err)
		respond.Error(w, r, a.logger, http.StatusBadGateway, "TMDB did not answer")
		return
	}
	s, err := loadSettings(r.Context(), a.db)
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	// With TMDB on, a new key asks again about every video: the films the
	// old key could not ask about.
	if err := a.change(r.Context(), s.TMDB && key != s.tmdbKey, func(tx *sql.Tx) error {
		return saveSetting(r.Context(), tx, keyTMDBKey, key)
	}); err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	who, _ := a.account(r.Context())
	a.logger.InfoContext(r.Context(), "tmdb key saved", "by", who.Name)
	s.tmdbKey = key
	respond.JSON(w, r, a.logger, http.StatusOK, statusOf(s))
}

// decode reads a small JSON request with only the expected fields.
func decode(w http.ResponseWriter, r *http.Request, into any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10))
	dec.DisallowUnknownFields()
	return dec.Decode(into) == nil
}

// change saves with save and, when askAll is true, asks about every
// video, all in one transaction.
func (a api) change(ctx context.Context, askAll bool, save func(tx *sql.Tx) error) (err error) {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("save online sources: %w", err)
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, tx.Rollback())
			return
		}
		if err = tx.Commit(); err == nil && askAll {
			a.newJobs()
		}
	}()
	if err := save(tx); err != nil {
		return err
	}
	if !askAll {
		return nil
	}
	// Enqueue in one statement: a library of thousands of videos is one
	// quick write, not thousands.
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO jobs (video_id, kind, state, updated_at)
		SELECT id, ?, 'pending', ? FROM videos WHERE missing_since IS NULL
		ON CONFLICT (video_id, kind) DO UPDATE
		SET state = 'pending', attempts = 0, last_error = '', run_after = 0, updated_at = excluded.updated_at`,
		string(jobs.Online), a.now().Unix()); err != nil {
		return fmt.Errorf("ask about every video: %w", err)
	}
	return nil
}
