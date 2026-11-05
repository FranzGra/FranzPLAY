package overview

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// The summary is for administrators only, and a database gone answers
// 500 with a plain message.
func TestOverviewRefusedAndFailing(t *testing.T) {
	db, err := database.Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	ask := func(account func(context.Context) (users.Account, bool)) *httptest.ResponseRecorder {
		a := api{db: db, logger: slog.New(slog.NewTextHandler(io.Discard, nil)), account: account,
			settings: Settings{Version: "1", DataDir: "/dati", Tools: true},
			disk:     func(string) (uint64, uint64, error) { return 100, 50, nil }}
		mux := http.NewServeMux()
		a.routes(mux)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/overview", nil))
		return rec
	}
	admin := func(context.Context) (users.Account, bool) { return users.Account{ID: 1, Role: users.Admin}, true }
	tests := []struct {
		name    string
		account func(context.Context) (users.Account, bool)
		want    int
	}{
		{"nobody logged in", func(context.Context) (users.Account, bool) { return users.Account{}, false }, http.StatusUnauthorized},
		{"not an administrator", func(context.Context) (users.Account, bool) { return users.Account{ID: 2, Role: "user"}, true }, http.StatusForbidden},
		{"administrator", admin, http.StatusOK},
	}
	for _, tt := range tests {
		if rec := ask(tt.account); rec.Code != tt.want {
			t.Errorf("%s: %d %s, want %d", tt.name, rec.Code, rec.Body, tt.want)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	if rec := ask(admin); rec.Code != http.StatusInternalServerError || strings.Contains(strings.ToLower(rec.Body.String()), "sql") {
		t.Errorf("database gone: %d %s, want 500 with no detail", rec.Code, rec.Body)
	}
}

// Routes puts the summary on the mux, for logged-in people only.
func TestRoutes(t *testing.T) {
	mux := http.NewServeMux()
	Routes(nil, Settings{}, slog.New(slog.NewTextHandler(io.Discard, nil)))(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/overview", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("GET /api/overview: %d, want 401", rec.Code)
	}
}
