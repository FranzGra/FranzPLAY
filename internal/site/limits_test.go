package site

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

func TestLooksAtTheLimits(t *testing.T) {
	tests := []struct {
		name string
		in   Look
		ok   bool
	}{
		{"16 emoji", Look{strings.Repeat("🎬", 16), "", "#2997ff", ""}, true},
		{"17 emoji", Look{strings.Repeat("🎬", 17), "", "#2997ff", ""}, false},
		{"16 letters in the second", Look{"F", strings.Repeat("x", 16), "#2997ff", ""}, true},
		{"17 letters in the second", Look{"F", strings.Repeat("x", 17), "#2997ff", ""}, false},
		{"16 letters after trimming", Look{"  " + strings.Repeat("x", 16) + "  ", "", "#2997ff", ""}, true},
		{"not utf-8", Look{"Fr\xffnz", "", "#2997ff", ""}, false},
		{"a tab inside", Look{"Fr\tnz", "", "#2997ff", ""}, false},
		{"a nul inside", Look{"Fr\x00nz", "", "#2997ff", ""}, false},
		{"a zero width joiner", Look{"F\u200dZ", "", "#2997ff", ""}, true},
		{"an arabic name", Look{"فرانز", "", "#2997ff", ""}, true},
		{"color with spaces inside", Look{"F", "", "#29 7ff", ""}, false},
		{"color of 8 digits", Look{"F", "", "#2997ffcc", ""}, false},
		{"color, letters past f", Look{"F", "", "#2997fg", ""}, false},
		{"color, a new line after", Look{"F", "", "#2997ff\n", ""}, true}, // trimmed
		{"shape with a new line inside", Look{"F", "", "#2997ff", "squ\nare"}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := tt.in.Clean()
			if (err == nil) != tt.ok {
				t.Errorf("Clean(%+q) error = %v, want ok %v", tt.in, err, tt.ok)
			}
		})
	}
}

func TestLookBodiesThatAreTooBigOrBroken(t *testing.T) {
	fx := newFixture(t)
	for name, body := range map[string]string{
		"more than 4 KB": `{"nameFirst": "Franz", "nameSecond": "PLAY", "color": "#2997ff", "categoryShape": "` +
			strings.Repeat(" ", 5000) + `square"}`,
		"a list":         `[]`,
		"null":           `null`,
		"empty":          ``,
		"a field twice":  `{"nameFirst": "", "nameFirst": "", "nameSecond": "", "color": "#2997ff"}`,
		"color a number": `{"nameFirst": "Franz", "nameSecond": "", "color": 2997}`,
	} {
		if rec := fx.do("PUT", body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d %s, want 400", name, rec.Code, rec.Body)
		}
	}
	if got := fx.look(t); got != Default {
		t.Errorf("the look changed anyway: %+v", got)
	}
}

// Many administrators saving at once: every answer is one of the looks
// sent, and the saved one is whole, never half of one and half of another.
func TestLooksSavedAtTheSameTimeStayWhole(t *testing.T) {
	db, err := database.Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	a := api{db: db, logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		account: func(context.Context) (users.Account, bool) { return users.Account{ID: 1, Role: users.Admin}, true }}
	mux := http.NewServeMux()
	a.routes(mux)

	const n = 16
	var wg sync.WaitGroup
	for i := range n {
		wg.Go(func() {
			body := fmt.Sprintf(`{"nameFirst": "Nome%d", "nameSecond": "Due%d", "color": "#0000%02x", "categoryShape": "square"}`, i, i, i)
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, httptest.NewRequest("PUT", "/api/site", strings.NewReader(body)))
			if rec.Code != http.StatusOK {
				t.Errorf("PUT %d = %d %s", i, rec.Code, rec.Body)
			}
		})
	}
	wg.Wait()
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/site", nil))
	var got Look
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	var i int
	if _, err := fmt.Sscanf(got.NameFirst, "Nome%d", &i); err != nil {
		t.Fatalf("saved %+v", got)
	}
	want := Look{fmt.Sprintf("Nome%d", i), fmt.Sprintf("Due%d", i), fmt.Sprintf("#0000%02x", i), "square"}
	if got != want {
		t.Errorf("saved %+v, a mix of two looks (want %+v)", got, want)
	}
}

// A database that fails answers 500 with no detail of the inside.
func TestLookWithABrokenDatabase(t *testing.T) {
	db, err := database.Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	a := api{db: db, logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		account: func(context.Context) (users.Account, bool) { return users.Account{ID: 1, Role: users.Admin}, true }}
	mux := http.NewServeMux()
	a.routes(mux)
	for _, req := range []*http.Request{
		httptest.NewRequest("GET", "/api/site", nil),
		httptest.NewRequest("PUT", "/api/site", strings.NewReader(`{"nameFirst": "F", "nameSecond": "", "color": "#2997ff"}`)),
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusInternalServerError || strings.Contains(rec.Body.String(), "sql") {
			t.Errorf("%s = %d %s", req.Method, rec.Code, rec.Body)
		}
	}
	if _, err := Load(context.Background(), db); err == nil {
		t.Error("Load on a closed database gave no error")
	}
}

func BenchmarkGetLook(b *testing.B) {
	db, err := database.Open(context.Background(), b.TempDir())
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = db.Close() })
	a := api{db: db, logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		account: func(context.Context) (users.Account, bool) { return users.Account{}, false }}
	mux := http.NewServeMux()
	a.routes(mux)
	req := httptest.NewRequest("GET", "/api/site", nil)
	b.ReportAllocs()
	for b.Loop() {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			b.Fatal(rec.Code)
		}
	}
}
