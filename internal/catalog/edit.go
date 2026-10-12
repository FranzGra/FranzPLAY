package catalog

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/FranzGra/FranzPLAY/internal/respond"
)

// The administrator can give a video another title and category. They
// change only what FranzPLAY shows: the file keeps its name and its folder
// (rule 1). They stay until the administrator puts back the found ones.

// Limits of what the administrator writes, as the database checks them.
const (
	maxTitle    = 200
	maxCategory = 100
)

// Errors shown to people.
var (
	errBadTitle    = errors.New("the title must be one line of 1 to 200 characters")
	errBadCategory = errors.New("the category must be one line of at most 100 characters")
)

// oneLine reports whether s is valid text without line breaks or other
// control characters, and at most limit characters long.
func oneLine(s string, limit int) bool {
	if !utf8.ValidString(s) || utf8.RuneCountInString(s) > limit {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

// cleanTitle checks a title chosen by the administrator. nil means "the
// one FranzPLAY found", and stays nil.
func cleanTitle(title *string) (*string, error) {
	if title == nil {
		return nil, nil
	}
	t := strings.TrimSpace(*title)
	if t == "" || !oneLine(t, maxTitle) {
		return nil, errBadTitle
	}
	return &t, nil
}

// cleanCategory checks a category chosen by the administrator. nil means
// "the folder's", "" means "no category".
func cleanCategory(category *string) (*string, error) {
	if category == nil {
		return nil, nil
	}
	c := strings.TrimSpace(*category)
	if !oneLine(c, maxCategory) {
		return nil, errBadCategory
	}
	return &c, nil
}

// detailsRequest is the body of PUT /api/admin/videos/{id}/details. A
// field null or left out puts back what FranzPLAY found.
type detailsRequest struct {
	Title    *string `json:"title"`
	Category *string `json:"category"`
}

func (a admin) handleDetails(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		respond.Error(w, r, a.logger, http.StatusNotFound, errNotFound.Error())
		return
	}
	var req detailsRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		respond.Error(w, r, a.logger, http.StatusBadRequest, "the request is not valid JSON with the expected fields")
		return
	}
	title, err := cleanTitle(req.Title)
	if err != nil {
		respond.Error(w, r, a.logger, http.StatusBadRequest, err.Error())
		return
	}
	category, err := cleanCategory(req.Category)
	if err != nil {
		respond.Error(w, r, a.logger, http.StatusBadRequest, err.Error())
		return
	}
	err = a.store.setDetails(r.Context(), id, title, category)
	if errors.Is(err, errNotFound) {
		respond.Error(w, r, a.logger, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	who, _ := a.account(r.Context())
	a.logger.InfoContext(r.Context(), "video details changed", "video", id,
		"title_set", title != nil, "category_set", category != nil, "by", who.Name)
	a.changed()
	w.WriteHeader(http.StatusNoContent)
}

// setDetails saves the title and category chosen by the administrator;
// nil puts back the found ones.
func (s store) setDetails(ctx context.Context, id int64, title, category *string) error {
	res, err := s.db.ExecContext(ctx, `UPDATE videos SET admin_title = ?, admin_category = ? WHERE id = ?`,
		title, category, id)
	if err != nil {
		return fmt.Errorf("change details of video %d: %w", id, err)
	}
	if n, err := res.RowsAffected(); err != nil {
		return fmt.Errorf("change details of video %d: %w", id, err)
	} else if n == 0 {
		return errNotFound
	}
	return nil
}
