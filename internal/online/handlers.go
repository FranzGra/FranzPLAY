package online

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// Routes adds the API of the sources on the internet, for administrators:
//
//	GET /api/online   which sources are on
//	PUT /api/online   turn them on or off {youtube}
//
// newJobs is called when turning a source on put work in the queue.
func Routes(db *sql.DB, newJobs func(), logger *slog.Logger) func(mux *http.ServeMux) {
	a := api{db: db, newJobs: newJobs, logger: logger, now: time.Now, account: users.FromContext}
	return func(mux *http.ServeMux) {
		mux.HandleFunc("GET /api/online", a.only(a.handleGet))
		mux.HandleFunc("PUT /api/online", a.only(a.handlePut))
	}
}

type api struct {
	db      *sql.DB
	newJobs func()
	logger  *slog.Logger
	now     func() time.Time
	account func(context.Context) (users.Account, bool)
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
	s, err := loadSources(r.Context(), a.db)
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	respond.JSON(w, r, a.logger, http.StatusOK, s)
}

func (a api) handlePut(w http.ResponseWriter, r *http.Request) {
	var next Sources
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&next); err != nil {
		respond.Error(w, r, a.logger, http.StatusBadRequest, "the request is not valid JSON with the expected fields")
		return
	}
	before, err := loadSources(r.Context(), a.db)
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	if err := a.apply(r.Context(), before, next); err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	who, _ := a.account(r.Context())
	a.logger.InfoContext(r.Context(), "online sources changed", "youtube", next.YouTube, "by", who.Name)
	respond.JSON(w, r, a.logger, http.StatusOK, next)
}

// apply saves the sources and, when one was just turned on, asks about
// every video, all in one transaction.
func (a api) apply(ctx context.Context, before, next Sources) (err error) {
	turnedOn := next.YouTube && !before.YouTube
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("save online sources: %w", err)
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, tx.Rollback())
			return
		}
		if err = tx.Commit(); err == nil && turnedOn {
			a.newJobs()
		}
	}()
	if err := saveSources(ctx, tx, next); err != nil {
		return err
	}
	if !turnedOn {
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
