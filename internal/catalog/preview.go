package catalog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/FranzGra/FranzPLAY/internal/sharing"
	sitelook "github.com/FranzGra/FranzPLAY/internal/site"
	"github.com/FranzGra/FranzPLAY/internal/webui"
)

// maxPreviewText is the longest description in a link preview: chat apps
// show two or three lines, and cut the rest anyway.
const maxPreviewText = 200

// LinkPreview describes the page of a public link, /p/{key}, for the
// apps that show a preview of an address sent in a chat: the cover, the
// title and the description of its video. A wrong or revoked key has no
// preview, so nobody learns anything about the videos of FranzPLAY.
func LinkPreview(db *sql.DB, logger *slog.Logger) webui.Previewer {
	s := store{db: db}
	return func(r *http.Request) (webui.Preview, bool) {
		key, ok := strings.CutPrefix(r.URL.Path, "/p/")
		if !ok || !sharing.ValidKey(key) {
			return webui.Preview{}, false
		}
		ctx := withPublicKey(r.Context(), key)
		v, err := s.publicVideo(ctx, key)
		if errors.Is(err, errNotFound) {
			return webui.Preview{}, false
		}
		if err != nil {
			logger.ErrorContext(ctx, "link preview", "error", err)
			return webui.Preview{}, false
		}
		look, err := sitelook.Load(ctx, db)
		if err != nil {
			// The preview still works, only without the site's name.
			logger.ErrorContext(ctx, "link preview", "error", err)
		}
		return previewOf(v, "/api/public/"+key, look.NameFirst+look.NameSecond), true
	}
}

// publicVideo returns the video of the public link key; ctx must carry
// the key (withPublicKey).
func (s store) publicVideo(ctx context.Context, key string) (Video, error) {
	var id int64
	err := s.db.QueryRowContext(ctx, `SELECT v.id FROM videos v WHERE `+publicWatchable, key).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return Video{}, errNotFound
	}
	if err != nil {
		return Video{}, fmt.Errorf("find public link: %w", err)
	}
	return s.get(ctx, id)
}

// previewOf is the preview of v, whose files are under base. Without a
// description of its own, the text says whose video it is and how long.
func previewOf(v Video, base, siteName string) webui.Preview {
	p := webui.Preview{Title: v.Title, SiteName: siteName}
	if v.Cover != nil {
		p.Image = base + "/cover"
	}
	if v.Description != nil {
		p.Description = shorten(strings.Join(strings.Fields(*v.Description), " "), maxPreviewText)
	}
	if p.Description == "" {
		// Shown to people, in the language of the interface.
		var parts []string
		switch {
		case v.Owner != nil && v.Owner.Name != "":
			parts = append(parts, "Un video di "+v.Owner.Name)
		case v.Owner == nil && siteName != "":
			parts = append(parts, "Un video di "+siteName) // from a folder: the site's own
		}
		if v.Duration != nil && *v.Duration > 0 {
			parts = append(parts, clock(*v.Duration))
		}
		p.Description = strings.Join(parts, " · ")
	}
	return p
}

// shorten cuts s to at most n characters, at a space when it can, and
// ends it with "…" when it cut something.
func shorten(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	cut := string([]rune(s)[:n-1])
	if at := strings.LastIndexByte(cut, ' '); at > n/2 {
		cut = cut[:at]
	}
	return strings.TrimRight(cut, " .,;:") + "…"
}

// clock writes seconds as a player does: "4:05", or "1:02:03" past an hour.
func clock(seconds int64) string {
	h, m, s := seconds/3600, seconds/60%60, seconds%60
	if h > 0 {
		return fmt.Sprintf("%d:%02d:%02d", h, m, s)
	}
	return fmt.Sprintf("%d:%02d", m, s)
}
