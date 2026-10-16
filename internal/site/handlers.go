package site

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// The keys of the settings table. A key never saved takes its value from Default.
const (
	keyNameFirst  = "site.name_first"
	keyNameSecond = "site.name_second"
	keyColor      = "site.color"
)

// maxBody is the largest request body accepted.
const maxBody = 4 << 10

// Routes adds the API of the site's look:
//
//	GET /api/site   name and color, for everybody, even before logging in
//	PUT /api/site   administrators only {nameFirst, nameSecond, color}
func Routes(db *sql.DB, logger *slog.Logger) func(mux *http.ServeMux) {
	a := api{db: db, logger: logger, account: users.FromContext}
	return a.routes
}

func (a api) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/site", a.handleGet)
	mux.HandleFunc("PUT /api/site", a.handlePut)
}

type api struct {
	db      *sql.DB
	logger  *slog.Logger
	account func(context.Context) (users.Account, bool)
}

// Load reads the look of the site, for the other parts of FranzPLAY.
func Load(ctx context.Context, db *sql.DB) (Look, error) { return load(ctx, db) }

// load reads the look; what was never saved comes from Default.
func load(ctx context.Context, db *sql.DB) (l Look, err error) {
	l = Default
	rows, err := db.QueryContext(ctx, `SELECT key, value FROM settings WHERE key IN (?, ?, ?)`,
		keyNameFirst, keyNameSecond, keyColor)
	if err != nil {
		return Look{}, fmt.Errorf("read site look: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return Look{}, fmt.Errorf("read site look: %w", err)
		}
		switch key {
		case keyNameFirst:
			l.NameFirst = value
		case keyNameSecond:
			l.NameSecond = value
		case keyColor:
			l.Color = value
		}
	}
	if err := rows.Err(); err != nil {
		return Look{}, fmt.Errorf("read site look: %w", err)
	}
	return l, nil
}

// save writes the look, all of it or nothing.
func save(ctx context.Context, db *sql.DB, l Look) (err error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("save site look: %w", err)
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, tx.Rollback())
		}
	}()
	for _, kv := range [][2]string{{keyNameFirst, l.NameFirst}, {keyNameSecond, l.NameSecond}, {keyColor, l.Color}} {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO settings (key, value) VALUES (?, ?)
			ON CONFLICT (key) DO UPDATE SET value = excluded.value`, kv[0], kv[1]); err != nil {
			return fmt.Errorf("save site look: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("save site look: %w", err)
	}
	return nil
}

func (a api) handleGet(w http.ResponseWriter, r *http.Request) {
	l, err := load(r.Context(), a.db)
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	respond.JSON(w, r, a.logger, http.StatusOK, l)
}

func (a api) handlePut(w http.ResponseWriter, r *http.Request) {
	who, ok := a.account(r.Context())
	if !ok {
		respond.Error(w, r, a.logger, http.StatusUnauthorized, "login required")
		return
	}
	if who.Role != users.Admin {
		respond.Error(w, r, a.logger, http.StatusForbidden, "administrators only")
		return
	}
	var next Look
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&next); err != nil {
		respond.Error(w, r, a.logger, http.StatusBadRequest, "the request is not valid JSON with the expected fields")
		return
	}
	clean, err := next.Clean()
	if err != nil {
		respond.Error(w, r, a.logger, http.StatusBadRequest, err.Error())
		return
	}
	if err := save(r.Context(), a.db, clean); err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	a.logger.InfoContext(r.Context(), "site look changed", "name_first", clean.NameFirst,
		"name_second", clean.NameSecond, "color", clean.Color, "by", who.Name)
	respond.JSON(w, r, a.logger, http.StatusOK, clean)
}
