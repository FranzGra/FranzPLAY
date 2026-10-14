package respond

import (
	"bytes"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestErrorIsJSON(t *testing.T) {
	rec := httptest.NewRecorder()
	Error(rec, httptest.NewRequest(http.MethodGet, "/api/x", nil), slog.Default(), http.StatusNotFound, "not found")
	if rec.Code != http.StatusNotFound || rec.Body.String() != "{\"error\":\"not found\"}\n" {
		t.Errorf("got %d %q", rec.Code, rec.Body)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q", ct)
	}
}

func TestInternalErrorKeepsDetailsInTheLog(t *testing.T) {
	var log bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&log, nil))
	rec := httptest.NewRecorder()
	InternalError(rec, httptest.NewRequest(http.MethodGet, "/api/x", nil), logger,
		errors.New("open /srv/secret/franzplay.db: disk I/O error"))

	if rec.Code != http.StatusInternalServerError || strings.Contains(rec.Body.String(), "secret") {
		t.Errorf("answer %d %q must not show the details", rec.Code, rec.Body)
	}
	if !strings.Contains(log.String(), "disk I/O error") {
		t.Errorf("log %q does not have the details", log.String())
	}
}
