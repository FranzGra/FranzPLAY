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
)

// This file is about the videos a person uploaded: their list, a new
// title, and taking one away.

var errVideoNotFound = errors.New("video not found")

// myVideo is one of my uploaded videos, as the upload page lists them.
type myVideo struct {
	ID      int64     `json:"id"`
	Title   string    `json:"title"`
	Size    int64     `json:"size"` // bytes
	AddedAt time.Time `json:"addedAt"`
	Cover   *string   `json:"cover"`  // address of the image; null = none yet
	Hidden  bool      `json:"hidden"` // hidden by an administrator
}

// videoRoutes adds the routes of my uploaded videos to mux:
//
//	GET    /api/uploads/videos       my uploaded videos, the newest first
//	PUT    /api/uploads/videos/{id}  a new title {title}
//	DELETE /api/uploads/videos/{id}  take it away from FranzPLAY, file included
func (s *Service) videoRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/uploads/videos", s.handleMyVideos)
	mux.HandleFunc("PUT /api/uploads/videos/{id}", s.handleRename)
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

type renameRequest struct {
	Title string `json:"title"`
}

func (s *Service) handleRename(w http.ResponseWriter, r *http.Request) {
	a, ok := s.account(r.Context())
	if !ok {
		respond.Error(w, r, s.logger, http.StatusUnauthorized, "login required")
		return
	}
	id, ok := s.uploadID(w, r)
	if !ok {
		return
	}
	var req renameRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		respond.Error(w, r, s.logger, http.StatusBadRequest, "the request is not valid JSON")
		return
	}
	title := strings.TrimSpace(req.Title)
	if !cleanText(title, maxTitle) {
		respond.Error(w, r, s.logger, http.StatusBadRequest, errBadTitle.Error())
		return
	}
	v, err := s.store.rename(r.Context(), a.ID, id, title)
	if errors.Is(err, errVideoNotFound) {
		respond.Error(w, r, s.logger, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		respond.InternalError(w, r, s.logger, err)
		return
	}
	s.changed() // the lists show the new title
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

const myVideoColumns = `id, shown_title, size, added_at, cover, hidden_at IS NOT NULL`

func scanMyVideo(row rowScanner) (myVideo, error) {
	var v myVideo
	var added int64
	var cover sql.NullString
	if err := row.Scan(&v.ID, &v.Title, &v.Size, &added, &cover, &v.Hidden); err != nil {
		return myVideo{}, err
	}
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
	return out, rows.Err()
}

// rename gives one of a person's videos a new title.
func (s store) rename(ctx context.Context, user, id int64, title string) (myVideo, error) {
	v, err := scanMyVideo(s.db.QueryRowContext(ctx, `UPDATE videos SET title = ?
		WHERE id = ? AND uploaded_by = ? AND missing_since IS NULL
		RETURNING `+myVideoColumns, title, id, user))
	if errors.Is(err, sql.ErrNoRows) {
		return myVideo{}, errVideoNotFound
	}
	if err != nil {
		return myVideo{}, fmt.Errorf("rename video %d: %w", id, err)
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
