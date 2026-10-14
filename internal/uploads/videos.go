package uploads

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/sharing"
)

// This file is about the videos a person uploaded: their list, a new
// title, who sees them, and taking one away.

var errVideoNotFound = errors.New("video not found")

// myVideo is one of my uploaded videos, as the upload page lists them.
type myVideo struct {
	ID      int64     `json:"id"`
	Title   string    `json:"title"`
	Size    int64     `json:"size"` // bytes
	AddedAt time.Time `json:"addedAt"`
	Cover   *string   `json:"cover"`   // address of the image; null = none yet
	Hidden  bool      `json:"hidden"`  // hidden by an administrator
	Private bool      `json:"private"` // only the uploader sees it, and SharedWith
	// SharedWith are the people a private video is shared with, by name.
	SharedWith []sharing.Person `json:"sharedWith"`
}

// videoRoutes adds the routes of my uploaded videos to mux:
//
//	GET    /api/uploads/videos       my uploaded videos, the newest first
//	PUT    /api/uploads/videos/{id}  a new title or who sees it {title?, private?, sharedWith?}
//	DELETE /api/uploads/videos/{id}  take it away from FranzPLAY, file included
func (s *Service) videoRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/uploads/videos", s.handleMyVideos)
	mux.HandleFunc("PUT /api/uploads/videos/{id}", s.handleChange)
	mux.HandleFunc("DELETE /api/uploads/videos/{id}", s.handleDeleteVideo)
}

func (s *Service) handleMyVideos(w http.ResponseWriter, r *http.Request) {
	a, ok := s.account(r.Context())
	if !ok {
		respond.Error(w, r, s.logger, http.StatusUnauthorized, "login required")
		return
	}
	list, err := s.store.myVideos(r.Context(), a.ID)
	if err != nil {
		respond.InternalError(w, r, s.logger, err)
		return
	}
	respond.JSON(w, r, s.logger, http.StatusOK, list)
}

// changeRequest changes one of my videos; a missing field stays as it is.
// SharedWith, the ids of the people who see a private video besides me,
// replaces the ones before; a video for everybody is shared with nobody.
type changeRequest struct {
	Title      *string  `json:"title"`
	Private    *bool    `json:"private"`
	SharedWith *[]int64 `json:"sharedWith"`
}

func (s *Service) handleChange(w http.ResponseWriter, r *http.Request) {
	a, ok := s.account(r.Context())
	if !ok {
		respond.Error(w, r, s.logger, http.StatusUnauthorized, "login required")
		return
	}
	id, ok := s.uploadID(w, r)
	if !ok {
		return
	}
	var req changeRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		respond.Error(w, r, s.logger, http.StatusBadRequest, "the request is not valid JSON")
		return
	}
	if req.Title != nil {
		title := strings.TrimSpace(*req.Title)
		if !cleanText(title, maxTitle) {
			respond.Error(w, r, s.logger, http.StatusBadRequest, errBadTitle.Error())
			return
		}
		req.Title = &title
	}
	if req.SharedWith != nil {
		people, err := sharing.Clean(*req.SharedWith, a.ID)
		if err != nil {
			s.fail(w, r, err)
			return
		}
		req.SharedWith = &people
	}
	v, err := s.store.change(r.Context(), a.ID, id, req)
	if errors.Is(err, errVideoNotFound) {
		respond.Error(w, r, s.logger, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		s.fail(w, r, err) // the people chosen, or an internal error
		return
	}
	s.changed() // the lists show the change
	respond.JSON(w, r, s.logger, http.StatusOK, v)
}

func (s *Service) handleDeleteVideo(w http.ResponseWriter, r *http.Request) {
	a, ok := s.account(r.Context())
	if !ok {
		respond.Error(w, r, s.logger, http.StatusUnauthorized, "login required")
		return
	}
	id, ok := s.uploadID(w, r)
	if !ok {
		return
	}
	err := s.store.deleteVideo(r.Context(), a.ID, id, s.folder)
	if errors.Is(err, errVideoNotFound) {
		respond.Error(w, r, s.logger, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		respond.InternalError(w, r, s.logger, err)
		return
	}
	s.logger.InfoContext(r.Context(), "uploaded video deleted", "video", id, "user", a.Name)
	s.changed() // the lists no longer show it
	w.WriteHeader(http.StatusNoContent)
}

const myVideoColumns = `id, shown_title, size, added_at, cover, hidden_at IS NOT NULL, private`

func scanMyVideo(row rowScanner) (myVideo, error) {
	var v myVideo
	var added int64
	var cover sql.NullString
	if err := row.Scan(&v.ID, &v.Title, &v.Size, &added, &cover, &v.Hidden, &v.Private); err != nil {
		return myVideo{}, err
	}
	v.SharedWith = []sharing.Person{}
	v.AddedAt = time.Unix(added, 0).UTC()
	if cover.Valid {
		address := "/api/covers/" + cover.String
		v.Cover = &address
	}
	return v, nil
}

// rowScanner is a *sql.Row or *sql.Rows.
type rowScanner interface{ Scan(dest ...any) error }

// myVideos returns the videos a person uploaded that are on the disk.
func (s store) myVideos(ctx context.Context, user int64) (_ []myVideo, err error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+myVideoColumns+` FROM videos
		WHERE uploaded_by = ? AND missing_since IS NULL ORDER BY added_at DESC, id DESC`, user)
	if err != nil {
		return nil, fmt.Errorf("list uploaded videos: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := []myVideo{}
	for rows.Next() {
		v, err := scanMyVideo(rows)
		if err != nil {
			return nil, fmt.Errorf("list uploaded videos: %w", err)
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list uploaded videos: %w", err)
	}
	people, err := sharing.People(ctx, s.db, sharesQuery+`
		WHERE s.video_id IN (SELECT id FROM videos WHERE uploaded_by = ?)`+sharesOrder, user)
	if err != nil {
		return nil, err
	}
	for i, v := range out {
		if p, ok := people[v.ID]; ok {
			out[i].SharedWith = p
		}
	}
	return out, nil
}

// sharesQuery and sharesOrder read the people videos are shared with, for
// sharing.People, around a WHERE.
const (
	sharesQuery = `SELECT s.video_id, u.id, u.name, u.avatar FROM video_shares s JOIN users u ON u.id = s.user_id`
	sharesOrder = ` ORDER BY u.name COLLATE NOCASE, u.id`
)

// change gives one of a person's videos a new title, or changes who sees
// it. The title and the people of req are already clean.
func (s store) change(ctx context.Context, user, id int64, req changeRequest) (_ myVideo, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return myVideo{}, fmt.Errorf("change video %d: %w", id, err)
	}
	defer func() { err = finishTx(tx, err) }()

	v, err := scanMyVideo(tx.QueryRowContext(ctx, `UPDATE videos
		SET title = coalesce(?, title), private = coalesce(?, private)
		WHERE id = ? AND uploaded_by = ? AND missing_since IS NULL
		RETURNING `+myVideoColumns, req.Title, req.Private, id, user))
	if errors.Is(err, sql.ErrNoRows) {
		return myVideo{}, errVideoNotFound
	}
	if err != nil {
		return myVideo{}, fmt.Errorf("change video %d: %w", id, err)
	}
	switch {
	case !v.Private:
		if req.SharedWith != nil && len(*req.SharedWith) > 0 {
			return myVideo{}, sharing.ErrNotPrivate
		}
		// Everybody sees it: nobody needs to be chosen any more.
		if _, err := tx.ExecContext(ctx, `DELETE FROM video_shares WHERE video_id = ?`, id); err != nil {
			return myVideo{}, fmt.Errorf("change video %d: %w", id, err)
		}
	case req.SharedWith != nil:
		if err := sharing.Known(ctx, tx, *req.SharedWith); err != nil {
			return myVideo{}, err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM video_shares WHERE video_id = ?`, id); err != nil {
			return myVideo{}, fmt.Errorf("change video %d: %w", id, err)
		}
		for _, person := range *req.SharedWith {
			if _, err := tx.ExecContext(ctx, `INSERT INTO video_shares (video_id, user_id) VALUES (?, ?)`,
				id, person); err != nil {
				return myVideo{}, fmt.Errorf("change video %d: %w", id, err)
			}
		}
	}
	people, err := sharing.People(ctx, tx, sharesQuery+` WHERE s.video_id = ?`+sharesOrder, id)
	if err != nil {
		return myVideo{}, err
	}
	if p, ok := people[id]; ok {
		v.SharedWith = p
	}
	return v, nil
}

// deleteVideo takes away one of a person's videos: its row, with its
// likes, comments and places in playlists, and its file. Only a file in
// the uploads folder is ever removed: a video of the video folders is
// never deleted from the disk (rule 1), whatever the database says.
// The file goes before the row is saved as gone: if it cannot be
// removed, nothing changes; covers and the rest are cleaned at the next
// start, like for any video FranzPLAY forgets.
func (s store) deleteVideo(ctx context.Context, user, id int64, uploads string) (err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("delete video %d: %w", id, err)
	}
	defer func() { err = finishTx(tx, err) }()

	var root, rel string
	err = tx.QueryRowContext(ctx, `DELETE FROM videos WHERE id = ? AND uploaded_by = ?
		RETURNING (SELECT path FROM libraries WHERE id = library_id), path`, id, user).Scan(&root, &rel)
	if errors.Is(err, sql.ErrNoRows) {
		return errVideoNotFound
	}
	if err != nil {
		return fmt.Errorf("delete video %d: %w", id, err)
	}
	if root != uploads {
		return fmt.Errorf("delete video %d: its file is in %q, not in the uploads folder: refused", id, root)
	}
	file := filepath.Join(root, filepath.FromSlash(rel))
	if !strings.HasPrefix(file, uploads+string(filepath.Separator)) {
		return fmt.Errorf("delete video %d: %q is outside the uploads folder: refused", id, file)
	}
	if err := os.Remove(file); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("delete video %d: %w", id, err)
	}
	return nil
}
