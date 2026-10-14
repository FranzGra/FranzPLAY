package sharing

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"

	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

type handlers struct {
	db     *sql.DB
	logger *slog.Logger
	// account returns the logged-in person: users.FromContext, replaced
	// only in tests.
	account func(context.Context) (users.Account, bool)
}

// Routes adds to mux the list of people to share with:
//
//	GET /api/people   everyone on FranzPLAY but me, by name
func Routes(db *sql.DB, logger *slog.Logger) func(mux *http.ServeMux) {
	return handlers{db: db, logger: logger, account: users.FromContext}.routes
}

func (h handlers) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/people", h.people)
}

func (h handlers) people(w http.ResponseWriter, r *http.Request) {
	a, ok := h.account(r.Context())
	if !ok {
		respond.Error(w, r, h.logger, http.StatusUnauthorized, "login required")
		return
	}
	list, err := everyone(r.Context(), h.db, a.ID)
	if err != nil {
		respond.InternalError(w, r, h.logger, err)
		return
	}
	respond.JSON(w, r, h.logger, http.StatusOK, list)
}
