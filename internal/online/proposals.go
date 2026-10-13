package online

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// When the administrator asked to confirm, what the sources find waits as
// a proposal: they see it, then use it or discard it.

// maxProposals is how many proposals are listed at once, the oldest first.
const maxProposals = 200

// proposal is one proposal as the administrator sees it.
type proposal struct {
	VideoID     int64  `json:"videoId"`
	Video       string `json:"video"` // the title people see now
	Source      string `json:"source"`
	Title       string `json:"title"`
	Author      string `json:"author"`
	Date        string `json:"date"`
	Description string `json:"description"`
	Picture     bool   `json:"picture"` // ask /api/online/proposals/{id}/picture
}

// errNoProposal means the video has no proposal that fits its content.
var errNoProposal = errors.New("no proposal for this video")

// fits is the condition of a proposal still found for its video's content.
const fits = `p.fingerprint = v.fingerprint`

// countProposals counts the proposals waiting.
func countProposals(ctx context.Context, db *sql.DB) (int, error) {
	var n int
	err := db.QueryRowContext(ctx, `SELECT count(*) FROM online_proposals p
		JOIN videos v ON v.id = p.video_id WHERE `+fits).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("count proposals: %w", err)
	}
	return n, nil
}

func (a api) handleProposals(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.QueryContext(r.Context(), `
		SELECT p.video_id, v.shown_title, p.source, coalesce(p.title, ''), coalesce(p.author, ''),
		       coalesce(p.published_on, ''), coalesce(p.description, ''), p.image IS NOT NULL
		FROM online_proposals p JOIN videos v ON v.id = p.video_id
		WHERE `+fits+` ORDER BY p.found_at, p.video_id LIMIT ?`, maxProposals)
	if err != nil {
		respond.InternalError(w, r, a.logger, fmt.Errorf("list proposals: %w", err))
		return
	}
	list := []proposal{}
	for rows.Next() {
		var p proposal
		if err := rows.Scan(&p.VideoID, &p.Video, &p.Source, &p.Title, &p.Author, &p.Date,
			&p.Description, &p.Picture); err != nil {
			respond.InternalError(w, r, a.logger, errors.Join(fmt.Errorf("list proposals: %w", err), rows.Close()))
			return
		}
		list = append(list, p)
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		respond.InternalError(w, r, a.logger, fmt.Errorf("list proposals: %w", err))
		return
	}
	respond.JSON(w, r, a.logger, http.StatusOK, map[string]any{"proposals": list})
}

// stored is a proposal as saved.
type stored struct {
	fingerprint string
	details     video.Details
	image       string
}

// read reads the proposal for a video, if it fits its content.
func (a api) read(ctx context.Context, videoID int64) (stored, error) {
	var p stored
	var title, description, author, date, image sql.NullString
	err := a.db.QueryRowContext(ctx, `
		SELECT p.fingerprint, p.title, p.description, p.author, p.published_on, p.image
		FROM online_proposals p JOIN videos v ON v.id = p.video_id
		WHERE p.video_id = ? AND `+fits, videoID).Scan(&p.fingerprint, &title, &description, &author, &date, &image)
	if errors.Is(err, sql.ErrNoRows) {
		return stored{}, errNoProposal
	}
	if err != nil {
		return stored{}, fmt.Errorf("read proposal for video %d: %w", videoID, err)
	}
	p.details = video.Details{Title: title.String, Description: description.String, Author: author.String,
		Date: date.String}
	p.image = image.String
	return p, nil
}

// proposalID reads the video of the address.
func proposalID(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	return id, err == nil && id > 0
}

func (a api) handleProposalPicture(w http.ResponseWriter, r *http.Request) {
	id, ok := proposalID(r)
	p, err := a.read(r.Context(), id)
	if !ok || errors.Is(err, errNoProposal) || (err == nil && p.image == "") {
		respond.Error(w, r, a.logger, http.StatusNotFound, errNoProposal.Error())
		return
	}
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	file, err := os.Open(filepath.Join(a.dataDir, Dir, filepath.Base(p.image)))
	if err != nil {
		respond.InternalError(w, r, a.logger, fmt.Errorf("open proposed picture: %w", err))
		return
	}
	defer func() {
		if err := file.Close(); err != nil {
			a.logger.WarnContext(r.Context(), "close proposed picture", "err", err)
		}
	}()
	w.Header().Set("Cache-Control", "private, no-cache")
	// No name: the type comes from the content, checked when it was saved.
	http.ServeContent(w, r, "", time.Time{}, file)
}

// handleAccept uses a proposal: it becomes what the internet says about
// the video, as if found without asking, and the cover is made again.
func (a api) handleAccept(w http.ResponseWriter, r *http.Request) {
	id, ok := proposalID(r)
	p, err := a.read(r.Context(), id)
	if !ok || errors.Is(err, errNoProposal) {
		respond.Error(w, r, a.logger, http.StatusNotFound, errNoProposal.Error())
		return
	}
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	what := found{details: p.details}
	if p.image != "" {
		if what.image, err = os.ReadFile(filepath.Join(a.dataDir, Dir, filepath.Base(p.image))); err != nil {
			respond.InternalError(w, r, a.logger, fmt.Errorf("read proposed picture: %w", err))
			return
		}
	}
	var oldImage sql.NullString
	if err := a.db.QueryRowContext(r.Context(), `SELECT online_cover FROM videos WHERE id = ?`, id).
		Scan(&oldImage); err != nil {
		respond.InternalError(w, r, a.logger, fmt.Errorf("read video %d: %w", id, err))
		return
	}
	f := &Fetcher{db: a.db, dataDir: a.dataDir, now: a.now}
	if err := f.save(r.Context(), id, p.fingerprint, oldImage.String, what); err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	if err := a.dismiss(r.Context(), id); err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	a.newJobs()
	who, _ := a.account(r.Context())
	a.logger.InfoContext(r.Context(), "online proposal used", "video", id, "by", who.Name)
	w.WriteHeader(http.StatusNoContent)
}

// handleDiscard throws a proposal away: the video keeps what it had.
func (a api) handleDiscard(w http.ResponseWriter, r *http.Request) {
	id, ok := proposalID(r)
	_, err := a.read(r.Context(), id)
	if !ok || errors.Is(err, errNoProposal) {
		respond.Error(w, r, a.logger, http.StatusNotFound, errNoProposal.Error())
		return
	}
	if err == nil {
		err = a.dismiss(r.Context(), id)
	}
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	who, _ := a.account(r.Context())
	a.logger.InfoContext(r.Context(), "online proposal discarded", "video", id, "by", who.Name)
	w.WriteHeader(http.StatusNoContent)
}

// dismiss removes the proposal of a video and its picture.
func (a api) dismiss(ctx context.Context, videoID int64) error {
	f := &Fetcher{db: a.db}
	image, err := f.proposalImage(ctx, videoID)
	if err != nil {
		return err
	}
	if _, err := a.db.ExecContext(ctx, `DELETE FROM online_proposals WHERE video_id = ?`, videoID); err != nil {
		return fmt.Errorf("remove proposal for video %d: %w", videoID, err)
	}
	if image == "" {
		return nil
	}
	return removeFile(filepath.Join(a.dataDir, Dir), image)
}
