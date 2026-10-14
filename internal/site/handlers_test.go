package site

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

type fixture struct {
	who    users.Account
	logged bool
	mux    *http.ServeMux
}

func newFixture(t *testing.T) *fixture {
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
	fx := &fixture{who: users.Account{ID: 1, Name: "Paolo", Role: users.Admin}, logged: true}
	a := api{db: db, logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		account: func(context.Context) (users.Account, bool) { return fx.who, fx.logged }}
	fx.mux = http.NewServeMux()
	a.routes(fx.mux)
	return fx
}

func (fx *fixture) do(method, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	fx.mux.ServeHTTP(rec, httptest.NewRequest(method, "/api/site", strings.NewReader(body)))
	return rec
}

func (fx *fixture) look(t *testing.T) Look {
	t.Helper()
	rec := fx.do("GET", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET = %d %s", rec.Code, rec.Body)
	}
	var l Look
	if err := json.Unmarshal(rec.Body.Bytes(), &l); err != nil {
		t.Fatal(err)
	}
	return l
}

func TestANewSiteLooksLikeFranzPLAY(t *testing.T) {
	fx := newFixture(t)
	fx.logged = false // the login page asks before anyone is in
	if got := fx.look(t); got != Default {
		t.Fatalf("look = %+v, want %+v", got, Default)
	}
}

func TestAdministratorChangesNameAndColor(t *testing.T) {
	fx := newFixture(t)
	rec := fx.do("PUT", `{"nameFirst": " Casa ", "nameSecond": "Rossi", "color": "#DC2626"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT = %d %s", rec.Code, rec.Body)
	}
	want := Look{NameFirst: "Casa", NameSecond: "Rossi", Color: "#dc2626"}
	if got := fx.look(t); got != want {
		t.Fatalf("after saving: %+v, want %+v", got, want)
	}
}

func TestOnlyAdministratorsChangeTheLook(t *testing.T) {
	fx := newFixture(t)
	body := `{"nameFirst": "Mio", "nameSecond": "", "color": "#000000"}`
	fx.who.Role = users.User
	if rec := fx.do("PUT", body); rec.Code != http.StatusForbidden {
		t.Errorf("normal user: %d", rec.Code)
	}
	fx.logged = false
	if rec := fx.do("PUT", body); rec.Code != http.StatusUnauthorized {
		t.Errorf("nobody logged in: %d", rec.Code)
	}
	if got := fx.look(t); got != Default {
		t.Errorf("the look changed anyway: %+v", got)
	}
}

func TestBadLooksAreRefused(t *testing.T) {
	fx := newFixture(t)
	for _, body := range []string{
		`{"nameFirst": "", "nameSecond": "PLAY", "color": "#2997ff"}`,
		`{"nameFirst": "Franz", "nameSecond": "PLAY", "color": "blue"}`,
		`{"nameFirst": "Franz", "nameSecond": "PLAY", "color": "#2997ff", "logo": "x"}`,
		`not json`,
	} {
		if rec := fx.do("PUT", body); rec.Code != http.StatusBadRequest {
			t.Errorf("PUT %s = %d, want 400", body, rec.Code)
		}
	}
	if got := fx.look(t); got != Default {
		t.Errorf("the look changed anyway: %+v", got)
	}
}
