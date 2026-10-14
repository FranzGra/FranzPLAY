package comments

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// Page sizes of the administrator's list of comments.
const (
	recentDefault = 50
	recentMax     = 200
)

// Recent is a comment in the administrator's list: every comment of every
// video, the newest first, with the video it is under.
type Recent struct {
	ID        int64     `json:"id"`
	Author    Author    `json:"author"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
	Video     VideoRef  `json:"video"`
	Reply     bool      `json:"reply"`   // it answers another comment
	Replies   int       `json:"replies"` // answers it has: they go when it goes
}

// VideoRef is the video a comment is under.
type VideoRef struct {
	ID      int64  `json:"id"`
	Title   string `json:"title"`
	Visible bool   `json:"visible"` // false: hidden or not found, its page cannot open
}

type recentList struct {
	Comments []Recent `json:"comments"`
	Total    int      `json:"total"`
}

// recent answers GET /api/comments (?limit=&offset=), administrators only.
func (h handlers) recent(w http.ResponseWriter, r *http.Request) {
	a, ok := h.account(r.Context())
	if !ok {
		respond.Error(w, r, h.logger, http.StatusUnauthorized, "login required")
		return
	}
	if a.Role != users.Admin {
		respond.Error(w, r, h.logger, http.StatusForbidden, "administrators only")
		return
	}
	limit, offset := recentDefault, 0
	if s := r.URL.Query().Get("limit"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > recentMax {
			respond.Error(w, r, h.logger, http.StatusBadRequest,
				fmt.Sprintf("limit must be a number from 1 to %d", recentMax))
			return
		}
		limit = n
	}
	if s := r.URL.Query().Get("offset"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 0 {
			respond.Error(w, r, h.logger, http.StatusBadRequest, "offset must be a number from 0")
			return
		}
		offset = n
	}
	list, err := h.store.recent(r.Context(), limit, offset)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	respond.JSON(w, r, h.logger, http.StatusOK, list)
}

// recent returns a page of every comment, the newest first.
func (s store) recent(ctx context.Context, limit, offset int) (_ recentList, err error) {
	out := recentList{Comments: []Recent{}}
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM comments`).Scan(&out.Total); err != nil {
		return recentList{}, fmt.Errorf("count comments: %w", err)
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT c.id, c.user_id, u.name, u.avatar, c.body, c.created_at, v.id, v.shown_title, v.visible,
			c.parent_id IS NOT NULL, (SELECT count(*) FROM comments r WHERE r.parent_id = c.id)
		FROM comments c
		JOIN users u ON u.id = c.user_id
		JOIN videos v ON v.id = c.video_id
		ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return recentList{}, fmt.Errorf("list comments: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		var c Recent
		var created int64
		if err := rows.Scan(&c.ID, &c.Author.ID, &c.Author.Name, &c.Author.Avatar, &c.Body, &created,
			&c.Video.ID, &c.Video.Title, &c.Video.Visible, &c.Reply, &c.Replies); err != nil {
			return recentList{}, fmt.Errorf("list comments: %w", err)
		}
		c.CreatedAt = time.Unix(created, 0).UTC()
		out.Comments = append(out.Comments, c)
	}
	return out, rows.Err()
}
