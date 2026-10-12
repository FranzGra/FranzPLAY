// Package server builds FranzPLAY's HTTP routes.
package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// New returns the handler with every route of the FranzPLAY API.
func New(version string, logger *slog.Logger) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", handleHealth(version, logger))
	return mux
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
