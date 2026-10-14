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
	"strings"
	"time"
	"unicode/utf8"

	"github.com/FranzGra/FranzPLAY/internal/playlists"
	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// Channel is a person's channel as the API shows it.
type Channel struct {
	ID        int64                `json:"id"`
	Name      string               `json:"name"`
	Avatar    int64                `json:"avatar"`    // version of their profile photo, 0 = none
	Since     time.Time            `json:"since"`     // when they joined FranzPLAY
	Playlists []playlists.Playlist `json:"playlists"` // public ones only
}

// Person is someone found by a search: only what everyone may see of
// them, never their email, role or anything private.
type Person struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	Avatar int64  `json:"avatar"` // version of their profile photo, 0 = none
}

// Search limits: longer searches are refused, extra words ignored, and a
// search shows at most maxFound people.
const (
	maxSearchLen   = 100 // characters
	maxSearchWords = 8
	maxFound       = 12
)

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
//	GET /api/channels?q=words  the people whose name has every word
//	GET /api/channels/{id}     a person's name and public playlists
func Routes(db *sql.DB, lists func(ctx context.Context, owner int64) ([]playlists.Playlist, error),
	logger *slog.Logger,
) func(mux *http.ServeMux) {
	return handlers{db: db, lists: lists, logger: logger, account: users.FromContext}.routes
}

func (h handlers) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/channels", h.search)
	mux.HandleFunc("GET /api/channels/{id}", h.channel)
}

func (h handlers) search(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.account(r.Context()); !ok {
		respond.Error(w, r, h.logger, http.StatusUnauthorized, "login required")
		return
	}
	q := r.URL.Query().Get("q")
	if utf8.RuneCountInString(q) > maxSearchLen {
		respond.Error(w, r, h.logger, http.StatusBadRequest,
			fmt.Sprintf("the search must be at most %d characters", maxSearchLen))
		return
	}
	people, err := h.find(r.Context(), searchWords(q))
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	respond.JSON(w, r, h.logger, http.StatusOK, map[string]any{"people": people})
}

// find returns, by name, the people whose name contains every word. No
// words finds nobody: a search box left empty is not "show everyone".
func (h handlers) find(ctx context.Context, words []string) (_ []Person, err error) {
	people := []Person{}
	if len(words) == 0 {
		return people, nil
	}
	where := make([]string, len(words))
	args := make([]any, 0, len(words)+1)
	for i, word := range words {
		where[i] = `name LIKE ? ESCAPE '\'`
		args = append(args, likePattern(word))
	}
	args = append(args, maxFound)
	rows, err := h.db.QueryContext(ctx, `SELECT id, name, avatar FROM users WHERE `+
		strings.Join(where, " AND ")+` ORDER BY name COLLATE NOCASE, id LIMIT ?`, args...)
	if err != nil {
		return nil, fmt.Errorf("search people: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		var p Person
		if err := rows.Scan(&p.ID, &p.Name, &p.Avatar); err != nil {
			return nil, fmt.Errorf("search people: %w", err)
		}
		people = append(people, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("search people: %w", err)
	}
	return people, nil
}

// searchWords splits a search into its words, without repeats and at most
// maxSearchWords: "anna  Rossi anna" becomes ["anna", "Rossi"].
func searchWords(search string) []string {
	var words []string
	seen := map[string]bool{}
	for _, w := range strings.Fields(search) {
		key := strings.ToLower(w)
		if seen[key] {
			continue
		}
		seen[key] = true
		words = append(words, w)
		if len(words) == maxSearchWords {
			break
		}
	}
	return words
}

// likePattern turns a word into a LIKE pattern that finds it anywhere,
// with LIKE's wildcards (% and _) escaped: "a_b" finds only "a_b".
// LIKE ignores case for the letters A to Z; that is enough for names.
func likePattern(word string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(word) + "%"
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
	err := h.db.QueryRowContext(ctx, `SELECT name, avatar, created_at FROM users WHERE id = ?`, id).
		Scan(&c.Name, &c.Avatar, &since)
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
