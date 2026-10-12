package playlists

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/catalog"
	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/sharing"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// videos is what this feature needs from the catalog.
type videos interface {
	ByIDs(ctx context.Context, ids []int64) ([]catalog.Video, error)
}

// Owner is the person a list belongs to.
type Owner struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// Playlist is a list as the API shows it.
type Playlist struct {
	ID     int64  `json:"id"`
	Kind   Kind   `json:"kind"`
	Name   string `json:"name"` // "" for WatchLater: the interface names it
	Owner  Owner  `json:"owner"`
	Public bool   `json:"public"` // on the owner's channel
	// SharedWith are the people a list not on the channel is shared with;
	// only its owner learns them, the others get [].
	SharedWith []sharing.Person `json:"sharedWith"`
	Videos     int              `json:"videos"` // how many, missing ones left out
	Cover      *string          `json:"cover"`  // the first video's cover; null = none
	UpdatedAt  time.Time        `json:"updatedAt"`
	Contains   *bool            `json:"contains,omitempty"` // has the video asked about, if any
}

// Page is a list with its videos, in order.
type Page struct {
	Playlist Playlist        `json:"playlist"`
	Videos   []catalog.Video `json:"videos"`
}

type handlers struct {
	store  store
	videos videos
	logger *slog.Logger
	now    func() time.Time
	// account returns the logged-in person: users.FromContext, replaced
	// only in tests.
	account func(context.Context) (users.Account, bool)
}

// Routes adds the playlists API to mux. Everyone changes only their own
// lists, and sees their own, the public ones of the others and the ones
// shared with them:
//
//	GET    /api/playlists                       my lists; ?video=ID also says which have it
//	POST   /api/playlists                       {name}: a new list
//	GET    /api/playlists/shared                the lists others shared with me
//	GET    /api/playlists/{id}                  a list with its videos
//	PUT    /api/playlists/{id}                  {name?, public?, sharedWith?}: rename, put on my
//	                                            channel, share with some people
//	DELETE /api/playlists/{id}                  delete the list (not its videos)
//	PUT    /api/playlists/{id}/videos/{video}   add a video at the end
//	DELETE /api/playlists/{id}/videos/{video}   take a video out
func Routes(db *sql.DB, lookup videos, logger *slog.Logger) func(mux *http.ServeMux) {
	return handlers{store: store{db: db}, videos: lookup, logger: logger, now: time.Now, account: users.FromContext}.routes
}

func (h handlers) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/playlists", h.list)
	mux.HandleFunc("POST /api/playlists", h.create)
	mux.HandleFunc("GET /api/playlists/shared", h.shared)
	mux.HandleFunc("GET /api/playlists/{id}", h.page)
	mux.HandleFunc("PUT /api/playlists/{id}", h.change)
	mux.HandleFunc("DELETE /api/playlists/{id}", h.remove)
	mux.HandleFunc("PUT /api/playlists/{id}/videos/{video}", h.add)
	mux.HandleFunc("DELETE /api/playlists/{id}/videos/{video}", h.take)
}

// user returns the logged-in person; it answers itself when nobody is.
func (h handlers) user(w http.ResponseWriter, r *http.Request) (int64, bool) {
	a, logged := h.account(r.Context())
	if !logged {
		respond.Error(w, r, h.logger, http.StatusUnauthorized, "login required")
		return 0, false
	}
	return a.ID, true
}

// parseID reads a positive id.
func parseID(s string) (int64, bool) {
	id, err := strconv.ParseInt(s, 10, 64)
	return id, err == nil && id > 0
}

// pathID reads a positive id from the address.
func pathID(r *http.Request, name string) (int64, bool) { return parseID(r.PathValue(name)) }

// visible returns the list of the address if the person may see it: one
// of theirs, or a public one. It answers itself otherwise.
func (h handlers) visible(w http.ResponseWriter, r *http.Request) (row, bool) {
	userID, ok := h.user(w, r)
	if !ok {
		return row{}, false
	}
	id, ok := pathID(r, "id")
	if !ok {
		respond.Error(w, r, h.logger, http.StatusNotFound, errNotFound.Error())
		return row{}, false
	}
	p, err := h.store.get(r.Context(), userID, id)
	if err != nil {
		h.fail(w, r, err)
		return row{}, false
	}
	return p, true
}

// mine returns the list of the address if it belongs to the person; it
// answers itself otherwise.
func (h handlers) mine(w http.ResponseWriter, r *http.Request) (row, bool) {
	p, ok := h.visible(w, r)
	if !ok {
		return row{}, false
	}
	if a, _ := h.account(r.Context()); p.owner != a.ID {
		h.fail(w, r, errNotYours)
		return row{}, false
	}
	return p, true
}

// fail answers an error: a refusal the person can understand, or an
// internal error.
func (h handlers) fail(w http.ResponseWriter, r *http.Request, err error) {
	status := 0
	switch {
	case errors.Is(err, errNotFound), errors.Is(err, errVideoNotFound):
		status = http.StatusNotFound
	case errors.Is(err, errBadName), errors.Is(err, sharing.ErrBadPeople),
		errors.Is(err, sharing.ErrUnknownPerson), errors.Is(err, sharing.ErrNotPrivate):
		status = http.StatusBadRequest
	case errors.Is(err, errNotYours):
		status = http.StatusForbidden
	case errors.Is(err, errFixed), errors.Is(err, errTooMany), errors.Is(err, errFull):
		status = http.StatusConflict
	default:
		respond.InternalError(w, r, h.logger, err)
		return
	}
	respond.Error(w, r, h.logger, status, err.Error())
}

// playlists turns rows into the API's lists, with the covers, as viewer
// sees them: the people a list is shared with only for its owner.
func (h handlers) playlists(ctx context.Context, rows []row, asked bool, viewer int64) ([]Playlist, error) {
	var firsts, mine []int64
	for _, p := range rows {
		if p.first != 0 {
			firsts = append(firsts, p.first)
		}
		if p.owner == viewer && p.kind == Ordinary && !p.public {
			mine = append(mine, p.id)
		}
	}
	found, err := h.videos.ByIDs(ctx, firsts)
	if err != nil {
		return nil, err
	}
	people, err := h.store.people(ctx, mine)
	if err != nil {
		return nil, err
	}
	covers := make(map[int64]*string, len(found))
	for _, v := range found {
		covers[v.ID] = v.Cover
	}
	list := make([]Playlist, 0, len(rows))
	for _, p := range rows {
		pl := Playlist{
			ID: p.id, Kind: p.kind, Name: p.name, Owner: Owner{ID: p.owner, Name: p.ownerName}, Public: p.public,
			SharedWith: []sharing.Person{}, Videos: p.videos, Cover: covers[p.first], UpdatedAt: p.updatedAt,
		}
		if shared, ok := people[p.id]; ok {
			pl.SharedWith = shared
		}
		if asked {
			pl.Contains = new(p.contains)
		}
		list = append(list, pl)
	}
	return list, nil
}

func (h handlers) list(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.user(w, r)
	if !ok {
		return
	}
	videoID := int64(0)
	if q := r.URL.Query().Get("video"); q != "" {
		if videoID, ok = parseID(q); !ok {
			respond.Error(w, r, h.logger, http.StatusBadRequest, "video must be a video id")
			return
		}
	}
	rows, err := h.store.list(r.Context(), userID, videoID, h.now())
	if err == nil {
		var list []Playlist
		if list, err = h.playlists(r.Context(), rows, videoID != 0, userID); err == nil {
			respond.JSON(w, r, h.logger, http.StatusOK, list)
			return
		}
	}
	respond.InternalError(w, r, h.logger, err)
}

// readJSON reads a small JSON body into v. Unknown fields are refused, so
// a typo in the interface is caught at once.
func readJSON(w http.ResponseWriter, r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10))
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

type nameRequest struct {
	Name string `json:"name"`
}

// readName reads {name} from the request; it answers itself when it is wrong.
func (h handlers) readName(w http.ResponseWriter, r *http.Request) (string, bool) {
	var req nameRequest
	if err := readJSON(w, r, &req); err != nil {
		respond.Error(w, r, h.logger, http.StatusBadRequest, `the request must be {"name": text}`)
		return "", false
	}
	name, err := cleanName(req.Name)
	if err != nil {
		h.fail(w, r, err)
		return "", false
	}
	return name, true
}

func (h handlers) create(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.user(w, r)
	if !ok {
		return
	}
	name, ok := h.readName(w, r)
	if !ok {
		return
	}
	p, err := h.store.create(r.Context(), userID, name, h.now())
	if err != nil {
		h.fail(w, r, err)
		return
	}
	list, err := h.playlists(r.Context(), []row{p}, false, userID)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	respond.JSON(w, r, h.logger, http.StatusCreated, list[0])
}

func (h handlers) page(w http.ResponseWriter, r *http.Request) {
	p, ok := h.visible(w, r)
	if !ok {
		return
	}
	ids, err := h.store.videoIDs(r.Context(), p.id)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	found, err := h.videos.ByIDs(r.Context(), ids)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	viewer, _ := h.account(r.Context())
	list, err := h.playlists(r.Context(), []row{p}, false, viewer.ID)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	if found == nil {
		found = []catalog.Video{}
	}
	respond.JSON(w, r, h.logger, http.StatusOK, Page{Playlist: list[0], Videos: found})
}

// changeRequest says what to change of a list; what is left out stays.
// SharedWith, the ids of the people who see a list not on my channel,
// replaces the ones before.
type changeRequest struct {
	Name       *string  `json:"name"`
	Public     *bool    `json:"public"`
	SharedWith *[]int64 `json:"sharedWith"`
}

func (h handlers) change(w http.ResponseWriter, r *http.Request) {
	p, ok := h.mine(w, r)
	if !ok {
		return
	}
	var req changeRequest
	if err := readJSON(w, r, &req); err != nil || (req.Name == nil && req.Public == nil && req.SharedWith == nil) {
		respond.Error(w, r, h.logger, http.StatusBadRequest,
			`the request must be {"name": text, "public": true or false, "sharedWith": [ids]}`)
		return
	}
	if p.kind == WatchLater {
		h.fail(w, r, errFixed)
		return
	}
	// Everything is checked first, so a refusal changes nothing.
	var name string
	if req.Name != nil {
		var err error
		if name, err = cleanName(*req.Name); err != nil {
			h.fail(w, r, err)
			return
		}
	}
	if req.SharedWith != nil {
		people, err := sharing.Clean(*req.SharedWith, p.owner)
		if err != nil {
			h.fail(w, r, err)
			return
		}
		req.SharedWith = &people
	}
	if req.Public != nil || req.SharedWith != nil {
		if err := h.store.audience(r.Context(), p.id, req.Public, req.SharedWith); err != nil {
			h.fail(w, r, err)
			return
		}
	}
	if req.Name != nil {
		if err := h.store.rename(r.Context(), p.id, name, h.now()); err != nil {
			h.fail(w, r, err)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// shared lists what others shared with me.
func (h handlers) shared(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.user(w, r)
	if !ok {
		return
	}
	rows, err := h.store.sharedWithMe(r.Context(), userID)
	if err == nil {
		var list []Playlist
		if list, err = h.playlists(r.Context(), rows, false, userID); err == nil {
			respond.JSON(w, r, h.logger, http.StatusOK, list)
			return
		}
	}
	respond.InternalError(w, r, h.logger, err)
}

func (h handlers) remove(w http.ResponseWriter, r *http.Request) {
	p, ok := h.mine(w, r)
	if !ok {
		return
	}
	if p.kind == WatchLater {
		h.fail(w, r, errFixed)
		return
	}
	if err := h.store.remove(r.Context(), p.id); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// item returns the list and the video of the address; it answers itself
// when one is not there.
func (h handlers) item(w http.ResponseWriter, r *http.Request) (row, int64, bool) {
	p, ok := h.mine(w, r)
	if !ok {
		return row{}, 0, false
	}
	videoID, ok := pathID(r, "video")
	if !ok {
		h.fail(w, r, errVideoNotFound)
		return row{}, 0, false
	}
	return p, videoID, true
}

func (h handlers) add(w http.ResponseWriter, r *http.Request) {
	p, videoID, ok := h.item(w, r)
	if !ok {
		return
	}
	if err := h.store.add(r.Context(), p.id, videoID, h.now()); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h handlers) take(w http.ResponseWriter, r *http.Request) {
	p, videoID, ok := h.item(w, r)
	if !ok {
		return
	}
	if err := h.store.take(r.Context(), p.id, videoID); err != nil {
		h.fail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// PublicLists returns what a channel shows of a person: their public
// lists, the most recently changed first.
func PublicLists(db *sql.DB, lookup videos) func(ctx context.Context, owner int64) ([]Playlist, error) {
	h := handlers{store: store{db: db}, videos: lookup}
	return func(ctx context.Context, owner int64) ([]Playlist, error) {
		rows, err := h.store.publicOf(ctx, owner)
		if err != nil {
			return nil, err
		}
		return h.playlists(ctx, rows, false, 0)
	}
}
