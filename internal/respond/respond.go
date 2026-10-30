// Package respond writes the API's answers, so every route answers the
// same way: JSON, with errors as {"error": "..."}.
package respond

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
)

// errorBody is the body of every API error.
type errorBody struct {
	Error string `json:"error"`
}

// JSON sends body as JSON. A failure is logged, never silently ignored.
func JSON(w http.ResponseWriter, r *http.Request, logger *slog.Logger, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		logger.ErrorContext(r.Context(), "write JSON response", "path", r.URL.Path, "error", err)
	}
}

// Error sends an API error with a short message for the interface.
func Error(w http.ResponseWriter, r *http.Request, logger *slog.Logger, status int, message string) {
	JSON(w, r, logger, status, errorBody{Error: message})
}

// InternalError logs what went wrong and sends a generic 500: details of
// the server's inside stay in the log, not in the browser.
func InternalError(w http.ResponseWriter, r *http.Request, logger *slog.Logger, err error) {
	if errors.Is(r.Context().Err(), context.Canceled) {
		// The page went away or stopped asking: nothing is wrong here.
		logger.DebugContext(r.Context(), "request canceled", "path", r.URL.Path, "error", err)
	} else {
		logger.ErrorContext(r.Context(), "request failed", "path", r.URL.Path, "error", err)
	}
	Error(w, r, logger, http.StatusInternalServerError, "internal error")
}
