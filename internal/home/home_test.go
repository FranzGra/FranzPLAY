package home

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

const (
	giulia int64 = 1
	marco  int64 = 2
)

type userKey struct{}

type site struct {
	db  *sql.DB
	mux *http.ServeMux
}

func newSite(t *testing.T) *site {
	t.Helper()
	db, err := database.Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	if _, err := db.Exec(`INSERT INTO users (id, name, password_hash, role, created_at)
		VALUES (1, 'Giulia', 'x', 'admin', 1), (2, 'Marco', 'x', 'user', 1)`); err != nil {
		t.Fatal(err)
	}
	s := &site{db: db, mux: http.NewServeMux()}
	handlers{
		db:     db,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		account: func(ctx context.Context) (users.Account, bool) {
			id, ok := ctx.Value(userKey{}).(int64)
			return users.Account{ID: id}, ok
		},
	}.routes(s.mux)
	return s
}

// do sends a request as user (0 = nobody logged in).
func (s *site) do(user int64, method, target, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if user != 0 {
		req = req.WithContext(context.WithValue(req.Context(), userKey{}, user))
	}
	rec := httptest.NewRecorder()
	s.mux.ServeHTTP(rec, req)
	return rec
}

func (s *site) layout(t *testing.T, rec *httptest.ResponseRecorder) []Row {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	var l Layout
	if err := json.NewDecoder(rec.Body).Decode(&l); err != nil {
		t.Fatal(err)
	}
	return l.Closed
}

func TestCloseAndOpenRows(t *testing.T) {
	s := newSite(t)
	if got := s.layout(t, s.do(giulia, http.MethodGet, "/api/home", "")); got == nil || len(got) != 0 {
		t.Fatalf("new person: %v, want every row open ([])", got)
	}

	s.layout(t, s.do(giulia, http.MethodPut, "/api/home/rows/liked", `{"open":false}`))
	// Closing twice changes nothing.
	s.layout(t, s.do(giulia, http.MethodPut, "/api/home/rows/liked", `{"open":false}`))
	got := s.layout(t, s.do(giulia, http.MethodPut, "/api/home/rows/continue", `{"open":false}`))
	if !slices.Equal(got, []Row{Continue, Liked}) {
		t.Errorf("Giulia closed %v, want [continue liked]", got)
	}
	if got := s.layout(t, s.do(marco, http.MethodGet, "/api/home", "")); len(got) != 0 {
		t.Errorf("Marco's Home: %v, want his own, all open", got)
	}

	got = s.layout(t, s.do(giulia, http.MethodPut, "/api/home/rows/liked", `{"open":true}`))
	if !slices.Equal(got, []Row{Continue}) {
		t.Errorf("after opening liked: %v, want [continue]", got)
	}
}

func TestEveryRowCanBeClosed(t *testing.T) {
	// The list in Go and the one in the database must agree.
	s := newSite(t)
	for _, row := range rows {
		s.layout(t, s.do(giulia, http.MethodPut, "/api/home/rows/"+string(row), `{"open":false}`))
	}
	if got := s.layout(t, s.do(giulia, http.MethodGet, "/api/home", "")); len(got) != len(rows) {
		t.Errorf("closed %v, want all of %v", got, rows)
	}
	if _, err := s.db.Exec(`INSERT INTO closed_home_rows (user_id, row) VALUES (1, 'other')`); err == nil {
		t.Error("the database accepted a row that does not exist")
	}
}

func TestRowsRefused(t *testing.T) {
	s := newSite(t)
	tests := []struct {
		name   string
		user   int64
		method string
		target string
		body   string
		want   int
	}{
		{"nobody logged in, get", 0, http.MethodGet, "/api/home", "", http.StatusUnauthorized},
		{"nobody logged in, put", 0, http.MethodPut, "/api/home/rows/liked", `{"open":false}`, http.StatusUnauthorized},
		{"unknown row", giulia, http.MethodPut, "/api/home/rows/other", `{"open":false}`, http.StatusNotFound},
		{"no open", giulia, http.MethodPut, "/api/home/rows/liked", `{}`, http.StatusBadRequest},
		{"open not true or false", giulia, http.MethodPut, "/api/home/rows/liked", `{"open":"no"}`, http.StatusBadRequest},
		{"other fields", giulia, http.MethodPut, "/api/home/rows/liked", `{"open":false,"x":1}`, http.StatusBadRequest},
	}
	for _, tt := range tests {
		if rec := s.do(tt.user, tt.method, tt.target, tt.body); rec.Code != tt.want {
			t.Errorf("%s: %d %s, want %d", tt.name, rec.Code, rec.Body, tt.want)
		}
	}
	if got := s.layout(t, s.do(giulia, http.MethodGet, "/api/home", "")); len(got) != 0 {
		t.Errorf("closed %v, want none", got)
	}
}

func TestRowsGoWithThePerson(t *testing.T) {
	s := newSite(t)
	s.layout(t, s.do(giulia, http.MethodPut, "/api/home/rows/saved", `{"open":false}`))
	if _, err := s.db.Exec(`DELETE FROM users WHERE id = 1`); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM closed_home_rows`).Scan(&n); err != nil || n != 0 {
		t.Errorf("rows left = %d (%v), want 0", n, err)
	}
}
