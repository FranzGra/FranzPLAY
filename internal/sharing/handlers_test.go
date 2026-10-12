package sharing

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

func openDB(t *testing.T) *sql.DB {
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
	if _, err := db.Exec(`INSERT INTO users (id, name, password_hash, role, created_at, avatar)
		VALUES (1, 'marco', 'x', 'admin', 1, 0), (2, 'Anna', 'x', 'user', 1, 7), (3, 'Zoe', 'x', 'user', 1, 0)`); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestPeople(t *testing.T) {
	db := openDB(t)
	mux := http.NewServeMux()
	handlers{db: db, logger: slog.New(slog.NewTextHandler(io.Discard, nil)), account: users.FromContext}.routes(mux)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/people", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("nobody logged in: status %d, want 401", rec.Code)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/people", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req.WithContext(users.NewContext(req.Context(), users.Account{ID: 3})))
	var got []Person
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	// Everyone but Zoe, by name whatever the capitals.
	want := []Person{{2, "Anna", 7}, {1, "marco", 0}}
	if rec.Code != http.StatusOK || !slices.Equal(got, want) {
		t.Errorf("people = %d %+v, want %+v", rec.Code, got, want)
	}
}

func TestKnown(t *testing.T) {
	db := openDB(t)
	ctx := context.Background()
	if err := Known(ctx, db, nil); err != nil {
		t.Errorf("nobody: %v", err)
	}
	if err := Known(ctx, db, []int64{2, 3}); err != nil {
		t.Errorf("Anna and Zoe: %v", err)
	}
	if err := Known(ctx, db, []int64{2, 9}); !errors.Is(err, ErrUnknownPerson) {
		t.Errorf("someone unknown: %v, want ErrUnknownPerson", err)
	}
}
