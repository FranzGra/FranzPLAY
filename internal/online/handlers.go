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
//	PUT /api/online            turn them on or off {youtube, tmdb, tpdb}
//	PUT /api/online/tmdb-key   save TMDB's key {key}, after TMDB said it is valid
//	PUT /api/online/tpdb-key   the same for ThePornDB
//	PUT /api/online/rules      the hours, the daily limit, the order and the confirm mode {from, to, daily, order, confirm}
//	GET /api/online/search     search a source by hand ?source=tmdb|tpdb&q=words
//	GET /api/online/picture    a picture a search found ?source=…&at=…
//	GET /api/online/proposals              what was found and waits for a yes
//	GET /api/online/proposals/{id}/picture its picture
//	POST /api/online/proposals/{id}        use it
//	DELETE /api/online/proposals/{id}      throw it away
//
// A key is never sent back: the answers only say if there is one.
// newJobs is called when the change put work in the queue.
func Routes(db *sql.DB, dataDir string, newJobs func(), logger *slog.Logger) func(mux *http.ServeMux) {
	client := &http.Client{Timeout: askTimeout}
	a := api{db: db, dataDir: dataDir, newJobs: newJobs, logger: logger, now: time.Now, account: users.FromContext,
		tmdb: newTMDB(client), tpdb: newTPDB(client)}
	return a.routes
}

func (a api) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/online", a.only(a.handleGet))
	mux.HandleFunc("PUT /api/online", a.only(a.handlePut))
	mux.HandleFunc("PUT /api/online/tmdb-key", a.only(a.handleKey(keyTMDBKey)))
	mux.HandleFunc("PUT /api/online/tpdb-key", a.only(a.handleKey(keyTPDBKey)))
	mux.HandleFunc("PUT /api/online/rules", a.only(a.handleRules))
	mux.HandleFunc("GET /api/online/search", a.only(a.handleSearch))
	mux.HandleFunc("GET /api/online/picture", a.only(a.handlePicture))
	mux.HandleFunc("GET /api/online/proposals", a.only(a.handleProposals))
	mux.HandleFunc("GET /api/online/proposals/{id}/picture", a.only(a.handleProposalPicture))
	mux.HandleFunc("POST /api/online/proposals/{id}", a.only(a.handleAccept))
	mux.HandleFunc("DELETE /api/online/proposals/{id}", a.only(a.handleDiscard))
}

type api struct {
	db      *sql.DB
	dataDir string
	newJobs func()
	logger  *slog.Logger
	now     func() time.Time
	account func(context.Context) (users.Account, bool)
	tmdb    tmdb
	tpdb    tpdb
}

// status is what the administrator sees of the settings.
type status struct {
	Sources
	TMDBKey    bool  `json:"tmdbKey"` // a key for TMDB is saved
	TPDBKey    bool  `json:"tpdbKey"` // a key for ThePornDB is saved
	Rules      Rules `json:"rules"`
	AskedToday int   `json:"askedToday"` // videos asked about today
	Proposals  int   `json:"proposals"`  // what was found and waits for a yes
}

// sendStatus answers with what the administrator sees of the settings.
func (a api) sendStatus(w http.ResponseWriter, r *http.Request, s settings) {
	n, err := countProposals(r.Context(), a.db)
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	respond.JSON(w, r, a.logger, http.StatusOK, status{Sources: s.Sources, TMDBKey: s.tmdbKey != "",
		TPDBKey: s.tpdbKey != "", Rules: s.rules, AskedToday: askedOn(s.asked, a.now()), Proposals: n})
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
	a.sendStatus(w, r, s)
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
	if (next.TMDB && s.tmdbKey == "") || (next.TPDB && s.tpdbKey == "") {
		respond.Error(w, r, a.logger, http.StatusConflict, "this source needs its key first")
		return
	}
	turnedOn := (next.YouTube && !s.YouTube) || (next.TMDB && !s.TMDB) || (next.TPDB && !s.TPDB)
	if err := a.change(r.Context(), turnedOn, func(tx *sql.Tx) error {
		return saveSources(r.Context(), tx, next)
	}); err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	who, _ := a.account(r.Context())
	a.logger.InfoContext(r.Context(), "online sources changed", "youtube", next.YouTube, "tmdb", next.TMDB,
		"tpdb", next.TPDB, "by", who.Name)
	s.Sources = next
	a.sendStatus(w, r, s)
}

// handleRules saves the administrator's rules. The questions waiting for
// the old hours or limit look again at once.
func (a api) handleRules(w http.ResponseWriter, r *http.Request) {
	var next Rules
	if !decode(w, r, &next) || !next.valid() {
		respond.Error(w, r, a.logger, http.StatusBadRequest,
			"the rules need hours from 0 to 23, a limit of at least 0, and every source once in the order")
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	err = saveRules(r.Context(), tx, next)
	if err == nil {
		_, err = tx.ExecContext(r.Context(), `UPDATE jobs SET run_after = 0
			WHERE kind = ? AND state = 'pending' AND attempts = 0`, string(jobs.Online))
	}
	if err == nil {
		err = tx.Commit()
	} else {
		err = errors.Join(err, tx.Rollback())
	}
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	a.newJobs()
	who, _ := a.account(r.Context())
	a.logger.InfoContext(r.Context(), "online rules changed", "from", next.From, "to", next.To,
		"daily", next.Daily, "order", strings.Join(next.Order, ","), "confirm", next.Confirm, "by", who.Name)
	s, err := loadSettings(r.Context(), a.db)
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	a.sendStatus(w, r, s)
}

// keySource is a source with a key: how its keys look, and how to ask
// it if one is valid.
type keySource struct {
	name  string // for the messages
	on    func(settings) bool
	key   func(*settings) *string
	valid func(key string) bool
	check func(ctx context.Context, key string) error
}

func (a api) keySources() map[string]keySource {
	return map[string]keySource{
		keyTMDBKey: {name: "TMDB", on: func(s settings) bool { return s.TMDB },
			key: func(s *settings) *string { return &s.tmdbKey }, valid: validTMDBKey, check: a.tmdb.checkKey},
		keyTPDBKey: {name: "ThePornDB", on: func(s settings) bool { return s.TPDB },
			key: func(s *settings) *string { return &s.tpdbKey }, valid: validTPDBKey, check: a.tpdb.checkKey},
	}
}

// handleKey saves the key of a source, after the source said it is valid.
func (a api) handleKey(setting string) http.HandlerFunc {
	source := a.keySources()[setting]
	return func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Key string `json:"key"`
		}
		if !decode(w, r, &in) {
			respond.Error(w, r, a.logger, http.StatusBadRequest, "the request is not valid JSON with the expected fields")
			return
		}
		key := strings.TrimSpace(in.Key)
		if !source.valid(key) {
			respond.Error(w, r, a.logger, http.StatusBadRequest, "this is not a "+source.name+" key")
			return
		}
		switch err := source.check(r.Context(), key); {
		case errors.Is(err, errKeyRefused):
			respond.Error(w, r, a.logger, http.StatusUnprocessableEntity, source.name+" refused the key")
			return
		case err != nil:
			a.logger.WarnContext(r.Context(), "key not checked", "source", source.name, "err", err)
			respond.Error(w, r, a.logger, http.StatusBadGateway, source.name+" did not answer")
			return
		}
		s, err := loadSettings(r.Context(), a.db)
		if err != nil {
			respond.InternalError(w, r, a.logger, err)
			return
		}
		// With the source on, a new key asks again about every video: the
		// ones the old key could not ask about.
		saved := source.key(&s)
		if err := a.change(r.Context(), source.on(s) && key != *saved, func(tx *sql.Tx) error {
			return saveSetting(r.Context(), tx, setting, key)
		}); err != nil {
			respond.InternalError(w, r, a.logger, err)
			return
		}
		who, _ := a.account(r.Context())
		a.logger.InfoContext(r.Context(), "key saved", "source", source.name, "by", who.Name)
		*saved = key
		a.sendStatus(w, r, s)
	}
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
