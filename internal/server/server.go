// Package server builds FranzPLAY's HTTP routes.
package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// New returns the handler for the whole site: the API under /api/,
// and the web interface (ui) for every other address.
func New(version string, logger *slog.Logger, ui http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", handleHealth(version, logger))
	mux.HandleFunc("/api/health", handleMethodNotAllowed(logger, "GET, HEAD"))
	// Unknown API addresses must answer 404, not the web interface.
	mux.HandleFunc("/api/", handleAPINotFound(logger))
	mux.Handle("/", ui)
	return mux
}

// errorResponse is the body of every API error.
type errorResponse struct {
	Error string `json:"error"`
}

// handleMethodNotAllowed answers a known API address called with the wrong method.
func handleMethodNotAllowed(logger *slog.Logger, allow string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Allow", allow)
		writeJSON(w, r, logger, http.StatusMethodNotAllowed, errorResponse{Error: "method not allowed"})
	}
}

// handleAPINotFound answers addresses under /api/ that do not exist.
func handleAPINotFound(logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, r, logger, http.StatusNotFound, errorResponse{Error: "not found"})
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
		writeJSON(w, r, logger, http.StatusOK, healthResponse{Status: "ok", Version: version})
	}
}

// writeJSON sends body as JSON. A failure is logged, never silently ignored.
func writeJSON(w http.ResponseWriter, r *http.Request, logger *slog.Logger, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		logger.ErrorContext(r.Context(), "write JSON response", "path", r.URL.Path, "error", err)
	}
}
