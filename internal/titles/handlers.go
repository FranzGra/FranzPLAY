package titles

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"path"
	"strings"
	"unicode/utf8"

	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// maxBody is the largest request body accepted: the rules and a few names.
const maxBody = 64 << 10

// The limits of a preview: a few names, as long as a file name can be.
const (
	maxPreviewNames = 20
	maxPreviewName  = 255
	examples        = 8
)

// Routes adds the API of the title rules, for administrators only:
//
//	GET  /api/admin/title-rules          {settings, presets, examples}
//	POST /api/admin/title-rules/preview  {settings, names, folders} -> {titles, folders}
//	PUT  /api/admin/title-rules          settings -> {settings, changed}
//
// retitle makes the titles again with the rules just saved (the scanner's
// Retitle) and says how many videos changed.
func Routes(db *sql.DB, retitle func(context.Context) (int, error), logger *slog.Logger) func(mux *http.ServeMux) {
	a := api{db: db, retitle: retitle, logger: logger, account: users.FromContext}
	return a.routes
}

type api struct {
	db      *sql.DB
	retitle func(context.Context) (int, error)
	logger  *slog.Logger
	account func(context.Context) (users.Account, bool)
}

func (a api) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/admin/title-rules", a.admin(a.handleGet))
	mux.HandleFunc("POST /api/admin/title-rules/preview", a.admin(a.handlePreview))
	mux.HandleFunc("PUT /api/admin/title-rules", a.admin(a.handlePut))
}

func (a api) admin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		who, ok := a.account(r.Context())
		if !ok {
			respond.Error(w, r, a.logger, http.StatusUnauthorized, "login required")
			return
		}
		if who.Role != users.Admin {
			respond.Error(w, r, a.logger, http.StatusForbidden, "administrators only")
			return
		}
		next(w, r)
	}
}

// Example is a real video of the folders, to see what the rules do to it.
type Example struct {
	File   string `json:"file"`   // the file name, with its extension
	Folder string `json:"folder"` // its folder, "" for the library itself
}

type page struct {
	Settings Settings  `json:"settings"`
	Presets  []Preset  `json:"presets"`
	Examples []Example `json:"examples"`
}

func (a api) handleGet(w http.ResponseWriter, r *http.Request) {
	s, err := Load(r.Context(), a.db)
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	ex, err := a.examples(r.Context())
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	respond.JSON(w, r, a.logger, http.StatusOK, page{Settings: s, Presets: Presets, Examples: ex})
}

// examples are the newest videos of the folders, one per name.
func (a api) examples(ctx context.Context) (_ []Example, err error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT path FROM videos WHERE uploaded_by IS NULL AND missing_since IS NULL
		ORDER BY added_at DESC, id DESC LIMIT 200`)
	if err != nil {
		return nil, fmt.Errorf("examples of names: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := []Example{}
	seen := make(map[string]bool)
	for rows.Next() && len(out) < examples {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, fmt.Errorf("examples of names: %w", err)
		}
		name := path.Base(p)
		if seen[name] {
			continue
		}
		seen[name] = true
		folder := path.Dir(p)
		if folder == "." {
			folder = ""
		}
		out = append(out, Example{File: name, Folder: path.Base(folder)})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("examples of names: %w", err)
	}
	return out, nil
}

type previewRequest struct {
	Settings Settings `json:"settings"`
	Names    []string `json:"names"`
	Folders  []string `json:"folders"`
}

type previewResponse struct {
	Titles  []string `json:"titles"`
	Folders []string `json:"folders"`
}

func (a api) handlePreview(w http.ResponseWriter, r *http.Request) {
	var req previewRequest
	if !decode(w, r, a.logger, &req) {
		return
	}
	if len(req.Names) > maxPreviewNames || len(req.Folders) > maxPreviewNames {
		respond.Error(w, r, a.logger, http.StatusBadRequest, fmt.Sprintf("Al massimo %d nomi da provare.", maxPreviewNames))
		return
	}
	for _, n := range append(append([]string{}, req.Names...), req.Folders...) {
		if !utf8.ValidString(n) || utf8.RuneCountInString(n) > maxPreviewName {
			respond.Error(w, r, a.logger, http.StatusBadRequest, fmt.Sprintf("Un nome da provare può avere al massimo %d caratteri.", maxPreviewName))
			return
		}
	}
	c, ok := a.compile(w, r, req.Settings)
	if !ok {
		return
	}
	out := previewResponse{Titles: make([]string, len(req.Names)), Folders: make([]string, len(req.Folders))}
	for i, n := range req.Names {
		// What a file name would become: a folder typed in front, with
		// "/" or "\", does not count.
		n = strings.ReplaceAll(n, `\`, "/")
		out.Titles[i] = c.Title(FileTitle(n))
	}
	for i, f := range req.Folders {
		out.Folders[i] = c.Category(f)
	}
	respond.JSON(w, r, a.logger, http.StatusOK, out)
}

type saved struct {
	Settings Settings `json:"settings"`
	Changed  int      `json:"changed"` // videos whose title or category changed
}

func (a api) handlePut(w http.ResponseWriter, r *http.Request) {
	var s Settings
	if !decode(w, r, a.logger, &s) {
		return
	}
	clean, ok := a.clean(w, r, s)
	if !ok {
		return
	}
	if err := Save(r.Context(), a.db, clean); err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	who, _ := a.account(r.Context())
	n, err := a.retitle(r.Context())
	if err != nil {
		// Saved anyway: the next scan makes the titles again.
		respond.InternalError(w, r, a.logger, err)
		return
	}
	a.logger.InfoContext(r.Context(), "title rules changed", "rules", len(clean.Rules),
		"categories", clean.Categories, "videos_changed", n, "by", who.Name)
	respond.JSON(w, r, a.logger, http.StatusOK, saved{Settings: clean, Changed: n})
}

// clean checks the settings and answers 400 with the reason when they are wrong.
func (a api) clean(w http.ResponseWriter, r *http.Request, s Settings) (Settings, bool) {
	clean, err := s.Clean()
	if err != nil {
		respond.Error(w, r, a.logger, http.StatusBadRequest, err.Error())
		return Settings{}, false
	}
	return clean, true
}

func (a api) compile(w http.ResponseWriter, r *http.Request, s Settings) (*Cleaner, bool) {
	clean, ok := a.clean(w, r, s)
	if !ok {
		return nil, false
	}
	c, err := clean.Compile()
	if err != nil {
		respond.Error(w, r, a.logger, http.StatusBadRequest, err.Error())
		return nil, false
	}
	return c, true
}

func decode(w http.ResponseWriter, r *http.Request, logger *slog.Logger, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		respond.Error(w, r, logger, http.StatusBadRequest, "La richiesta non è valida.")
		return false
	}
	return true
}
