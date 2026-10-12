// Package home remembers how each person arranged their Home: which rows
// they closed. It follows them on every device, as in the old FranzPLAY.
package home

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"

	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// Row is a row of the Home that can be closed.
type Row string

// The rows of the Home. The list is closed: the database accepts only
// these.
const (
	Continue    Row = "continue"    // "Continua a guardare"
	Saved       Row = "saved"       // "I tuoi salvati"
	Liked       Row = "liked"       // "Ti piacciono"
	Recommended Row = "recommended" // "Potrebbe piacerti"
	Latest      Row = "latest"      // "Ultimi arrivati"
)

var rows = []Row{Continue, Saved, Liked, Recommended, Latest}

// parseRow checks a row named in an address, once, at the edge.
func parseRow(s string) (Row, bool) {
	r := Row(s)
	return r, slices.Contains(rows, r)
}

// Layout is how a person arranged their Home.
type Layout struct {
	Closed []Row `json:"closed"` // the rows closed; the others are open
}

type handlers struct {
	db     *sql.DB
	logger *slog.Logger
	// account returns the logged-in person: users.FromContext, replaced
	// only in tests.
	account func(context.Context) (users.Account, bool)
}

// Routes adds the Home layout API to mux, for the logged-in person:
//
//	GET /api/home             {closed: [row…]}
//	PUT /api/home/rows/{row}  {open}: open or close a row; answers the layout
func Routes(db *sql.DB, logger *slog.Logger) func(mux *http.ServeMux) {
	return handlers{db: db, logger: logger, account: users.FromContext}.routes
}

func (h handlers) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/home", h.get)
	mux.HandleFunc("PUT /api/home/rows/{row}", h.set)
}

func (h handlers) get(w http.ResponseWriter, r *http.Request) {
	a, logged := h.account(r.Context())
	if !logged {
		respond.Error(w, r, h.logger, http.StatusUnauthorized, "login required")
		return
	}
	h.answer(w, r, a.ID)
}

type setRequest struct {
	Open *bool `json:"open"`
}

func (h handlers) set(w http.ResponseWriter, r *http.Request) {
	a, logged := h.account(r.Context())
	if !logged {
		respond.Error(w, r, h.logger, http.StatusUnauthorized, "login required")
		return
	}
	row, ok := parseRow(r.PathValue("row"))
	if !ok {
		respond.Error(w, r, h.logger, http.StatusNotFound, "there is no such row on the Home")
		return
	}
	var req setRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil || req.Open == nil {
		respond.Error(w, r, h.logger, http.StatusBadRequest, "the request must be {\"open\": true or false}")
		return
	}
	var err error
	if *req.Open {
		_, err = h.db.ExecContext(r.Context(), `DELETE FROM closed_home_rows WHERE user_id = ? AND row = ?`, a.ID, row)
	} else {
		_, err = h.db.ExecContext(r.Context(), `INSERT INTO closed_home_rows (user_id, row) VALUES (?, ?)
			ON CONFLICT DO NOTHING`, a.ID, row)
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, fmt.Errorf("save home row: %w", err))
		return
	}
	h.answer(w, r, a.ID)
}

// answer sends the layout of a person's Home.
func (h handlers) answer(w http.ResponseWriter, r *http.Request, userID int64) {
	l, err := h.layout(r.Context(), userID)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	respond.JSON(w, r, h.logger, http.StatusOK, l)
}

func (h handlers) layout(ctx context.Context, userID int64) (_ Layout, err error) {
	q, err := h.db.QueryContext(ctx, `SELECT row FROM closed_home_rows WHERE user_id = ? ORDER BY row`, userID)
	if err != nil {
		return Layout{}, fmt.Errorf("read home rows: %w", err)
	}
	defer func() { err = errors.Join(err, q.Close()) }()
	l := Layout{Closed: []Row{}}
	for q.Next() {
		var row Row
		if err := q.Scan(&row); err != nil {
			return Layout{}, fmt.Errorf("read home rows: %w", err)
		}
		l.Closed = append(l.Closed, row)
	}
	return l, q.Err()
}
