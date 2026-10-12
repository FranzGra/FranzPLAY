// Package channels shows the channel of each person: who they are and
// the playlists they chose to show to everyone.
package channels

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/playlists"
	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// Channel is a person's channel as the API shows it.
type Channel struct {
	ID        int64                `json:"id"`
	Name      string               `json:"name"`
	Since     time.Time            `json:"since"`     // when they joined FranzPLAY
	Playlists []playlists.Playlist `json:"playlists"` // public ones only
}

var errNotFound = errors.New("channel not found")

type handlers struct {
	db *sql.DB
	// lists returns the public playlists of a person.
	lists  func(ctx context.Context, owner int64) ([]playlists.Playlist, error)
	logger *slog.Logger
	// account returns the logged-in person: users.FromContext, replaced
	// only in tests.
	account func(context.Context) (users.Account, bool)
}

// Routes adds the channels API to mux. Everyone logged in can see every
// channel:
//
//	GET /api/channels/{id}   a person's name and public playlists
func Routes(db *sql.DB, lists func(ctx context.Context, owner int64) ([]playlists.Playlist, error),
	logger *slog.Logger,
) func(mux *http.ServeMux) {
	return handlers{db: db, lists: lists, logger: logger, account: users.FromContext}.routes
}

func (h handlers) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/channels/{id}", h.channel)
}

func (h handlers) channel(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.account(r.Context()); !ok {
		respond.Error(w, r, h.logger, http.StatusUnauthorized, "login required")
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		respond.Error(w, r, h.logger, http.StatusNotFound, errNotFound.Error())
		return
	}
	c, err := h.read(r.Context(), id)
	if errors.Is(err, errNotFound) {
		respond.Error(w, r, h.logger, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	respond.JSON(w, r, h.logger, http.StatusOK, c)
}

// read returns the channel of a person.
func (h handlers) read(ctx context.Context, id int64) (Channel, error) {
	c := Channel{ID: id}
	var since int64
	err := h.db.QueryRowContext(ctx, `SELECT name, created_at FROM users WHERE id = ?`, id).Scan(&c.Name, &since)
	if errors.Is(err, sql.ErrNoRows) {
		return Channel{}, errNotFound
	}
	if err != nil {
		return Channel{}, fmt.Errorf("read user %d: %w", id, err)
	}
	c.Since = time.Unix(since, 0).UTC()
	if c.Playlists, err = h.lists(ctx, id); err != nil {
		return Channel{}, fmt.Errorf("read channel %d: %w", id, err)
	}
	return c, nil
}
