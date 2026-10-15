package updates

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// Routes adds the API for administrators:
//
//	GET /api/updates   installed version, latest release found, the setting
//	PUT /api/updates   {enabled}: check GitHub once a day, or never
func (c *Checker) Routes(logger *slog.Logger) func(mux *http.ServeMux) {
	a := api{c: c, logger: logger, account: users.FromContext}
	return a.routes
}

type api struct {
	c       *Checker
	logger  *slog.Logger
	account func(context.Context) (users.Account, bool)
}

func (a api) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/updates", a.adminOnly(a.handleGet))
	mux.HandleFunc("PUT /api/updates", a.adminOnly(a.handlePut))
}

func (a api) adminOnly(next http.HandlerFunc) http.HandlerFunc {
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

func (a api) handleGet(w http.ResponseWriter, r *http.Request) {
	s, err := a.c.Status(r.Context())
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	respond.JSON(w, r, a.logger, http.StatusOK, s)
}

func (a api) handlePut(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled *bool `json:"enabled"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil || req.Enabled == nil {
		respond.Error(w, r, a.logger, http.StatusBadRequest, "bad request")
		return
	}
	if err := a.c.SetEnabled(r.Context(), *req.Enabled); err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	who, _ := a.account(r.Context())
	a.logger.InfoContext(r.Context(), "update check changed", "enabled", *req.Enabled, "by", who.Name)
	a.handleGet(w, r)
}
