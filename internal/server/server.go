// Package server builds FranzPLAY's HTTP routes.
package server

import (
	"log/slog"
	"net/http"

	"github.com/FranzGra/FranzPLAY/internal/respond"
)

// Routes adds a feature's API routes to the site.
type Routes func(mux *http.ServeMux)

// New returns the handler for the whole site: the API under /api/,
// and the web interface (ui) for every other address.
func New(version string, logger *slog.Logger, ui http.Handler, features ...Routes) http.Handler {
	mux := http.NewServeMux()
	for _, add := range features {
		add(mux)
	}
	mux.HandleFunc("GET /api/health", handleHealth(version, logger))
	mux.HandleFunc("/api/health", handleMethodNotAllowed(logger, "GET, HEAD"))
	// Unknown API addresses must answer 404, not the web interface.
	mux.HandleFunc("/api/", handleAPINotFound(logger))
	mux.Handle("/", ui)
	return mux
}

// handleMethodNotAllowed answers a known API address called with the wrong method.
func handleMethodNotAllowed(logger *slog.Logger, allow string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Allow", allow)
		respond.Error(w, r, logger, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// handleAPINotFound answers addresses under /api/ that do not exist.
func handleAPINotFound(logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		respond.Error(w, r, logger, http.StatusNotFound, "not found")
	}
}

// healthResponse is the body of GET /api/health.
type healthResponse struct {
	Status  string `json:"status"`
	Version string `json:"version"`
}

// handleHealth answers "I'm alive", so people and tools can check the server is running.
func handleHealth(version string, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		respond.JSON(w, r, logger, http.StatusOK, healthResponse{Status: "ok", Version: version})
	}
}
