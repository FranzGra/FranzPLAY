package home

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// With the database gone, every route answers 500 with a plain message.
func TestDatabaseFailing(t *testing.T) {
	s := newSite(t)
	if err := s.db.Close(); err != nil {
		t.Fatal(err)
	}
	for _, r := range []struct{ method, target, body string }{
		{http.MethodGet, "/api/home", ""},
		{http.MethodPut, "/api/home/rows/liked", `{"open":false}`},
		{http.MethodPut, "/api/home/look", `{"columns":3,"size":3,"sections":"one"}`},
	} {
		rec := s.do(giulia, r.method, r.target, r.body)
		if rec.Code != http.StatusInternalServerError || strings.Contains(strings.ToLower(rec.Body.String()), "sql") {
			t.Errorf("%s %s: %d %s, want 500 with no detail", r.method, r.target, rec.Code, rec.Body)
		}
	}
}

// Routes puts every route on the mux, for logged-in people only.
func TestRoutes(t *testing.T) {
	s := newSite(t)
	mux := http.NewServeMux()
	Routes(s.db, slog.New(slog.NewTextHandler(io.Discard, nil)))(mux)
	for _, r := range []struct{ method, target string }{
		{http.MethodGet, "/api/home"},
		{http.MethodPut, "/api/home/rows/liked"},
		{http.MethodPut, "/api/home/look"},
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), r.method, r.target, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: %d, want 401", r.method, r.target, rec.Code)
		}
	}
}
