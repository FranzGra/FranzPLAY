package online

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// With the database gone, the administrator's pages answer 500 with a
// plain message: no panic, no detail, no key.
func TestDatabaseFailing(t *testing.T) {
	fx := newAdminFixture(t)
	if err := fx.db.Close(); err != nil {
		t.Fatal(err)
	}
	for _, r := range []struct{ method, target, body string }{
		{http.MethodGet, "/api/online", ""},
		{http.MethodPut, "/api/online", `{"youtube": true}`},
		{http.MethodPut, "/api/online/rules", `{"from":0,"to":0,"daily":0,"order":["youtube","tmdb","tpdb"],"confirm":false}`},
		{http.MethodGet, "/api/online/proposals", ""},
		{http.MethodGet, "/api/online/proposals/1/picture", ""},
		{http.MethodPost, "/api/online/proposals/1", ""},
		{http.MethodDelete, "/api/online/proposals/1", ""},
	} {
		rec := fx.do(r.method, r.target, r.body)
		if rec.Code != http.StatusInternalServerError || strings.Contains(strings.ToLower(rec.Body.String()), "sql") {
			t.Errorf("%s %s: %d %s, want 500 with no detail", r.method, r.target, rec.Code, rec.Body)
		}
	}
}

// Routes puts every route on the mux, for logged-in administrators only.
func TestRoutes(t *testing.T) {
	fx := newFixture(t, "Gita.mp4", false)
	mux := http.NewServeMux()
	Routes(fx.db, "", func() {}, slog.New(slog.NewTextHandler(io.Discard, nil)))(mux)
	for _, r := range []struct{ method, target string }{
		{http.MethodGet, "/api/online"},
		{http.MethodPut, "/api/online"},
		{http.MethodPut, "/api/online/tmdb-key"},
		{http.MethodPut, "/api/online/tpdb-key"},
		{http.MethodPut, "/api/online/rules"},
		{http.MethodGet, "/api/online/search"},
		{http.MethodGet, "/api/online/picture"},
		{http.MethodGet, "/api/online/proposals"},
		{http.MethodGet, "/api/online/proposals/1/picture"},
		{http.MethodPost, "/api/online/proposals/1"},
		{http.MethodDelete, "/api/online/proposals/1"},
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), r.method, r.target, nil))
		if rec.Code != http.StatusUnauthorized && rec.Code != http.StatusForbidden {
			t.Errorf("%s %s: %d, want 401 or 403", r.method, r.target, rec.Code)
		}
	}
}
