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
	return secureHeaders(mux)
}

// contentPolicy lets pages run only FranzPLAY's own scripts and stops other
// sites from showing FranzPLAY inside a frame of theirs (clickjacking).
// Images and media stay unrestricted: online covers come from other sites.
const contentPolicy = "script-src 'self'; object-src 'none'; base-uri 'self'; " +
	"form-action 'self'; frame-ancestors 'self'"

// secureHeaders adds the browser protections every answer should carry.
// A handler can still replace one of them, as the public link pages do
// with Referrer-Policy.
func secureHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", contentPolicy)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "SAMEORIGIN")
		h.Set("Referrer-Policy", "same-origin")
		next.ServeHTTP(w, r)
	})
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
