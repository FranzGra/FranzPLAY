package online

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/users"
)

type adminFixture struct {
	*fixture
	who   users.Account
	woken int
	mux   *http.ServeMux
}

func newAdminFixture(t *testing.T) *adminFixture {
	fx := &adminFixture{fixture: newFixture(t, "Gita [dQw4w9WgXcQ].mp4", false),
		who: users.Account{ID: 1, Name: "Francesco", Role: users.Admin}}
	if _, err := fx.db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, added_at, missing_since)
		VALUES ('fingerprint-2', 1, 'via.mp4', 1, 1, 'via', 1, 5)`); err != nil {
		t.Fatal(err)
	}
	a := api{db: fx.db, dataDir: fx.dataDir, newJobs: func() { fx.woken++ }, logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		now:     func() time.Time { return time.Unix(1000, 0) },
		account: func(context.Context) (users.Account, bool) { return fx.who, true },
		tmdb:    fx.f.tmdb, tpdb: fx.f.tpdb}
	fx.mux = http.NewServeMux()
	a.routes(fx.mux)
	return fx
}

func (fx *adminFixture) do(method, path, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	fx.mux.ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
	return rec
}

func (fx *adminFixture) onlineJobs(t *testing.T) int {
	t.Helper()
	var n int
	if err := fx.db.QueryRow(`SELECT count(*) FROM jobs WHERE kind = 'online' AND state = 'pending'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (fx *adminFixture) allDone(t *testing.T) {
	t.Helper()
	if _, err := fx.db.Exec(`UPDATE jobs SET state = 'done'`); err != nil {
		t.Fatal(err)
	}
}

func TestAdministratorTurnsSourcesOn(t *testing.T) {
	fx := newAdminFixture(t)

	if rec := fx.do("GET", "/api/online", ""); rec.Code != http.StatusOK ||
		strings.TrimSpace(rec.Body.String()) != `{"youtube":false,"tmdb":false,"tpdb":false,"tmdbKey":false,"tpdbKey":false,"rules":{"from":0,"to":0,"daily":0,"order":["youtube","tmdb","tpdb"],"confirm":false},"askedToday":0,"proposals":0}` {
		t.Fatalf("GET = %d %s", rec.Code, rec.Body)
	}
	if rec := fx.do("PUT", "/api/online", `{"youtube": true, "tmdb": false}`); rec.Code != http.StatusOK {
		t.Fatalf("PUT = %d %s", rec.Code, rec.Body)
	}
	// Every video present is asked about once; the missing one is not.
	if n := fx.onlineJobs(t); n != 1 || fx.woken != 1 {
		t.Errorf("online jobs = %d, worker woken %d times; want 1 and 1", n, fx.woken)
	}
	var s status
	if rec := fx.do("GET", "/api/online", ""); json.Unmarshal(rec.Body.Bytes(), &s) != nil || !s.YouTube {
		t.Errorf("after turning on: %s", rec.Body)
	}

	// Saving again, or turning off, asks nothing new.
	fx.allDone(t)
	for _, body := range []string{`{"youtube": true}`, `{"youtube": false}`} {
		if rec := fx.do("PUT", "/api/online", body); rec.Code != http.StatusOK {
			t.Fatalf("PUT %s = %d", body, rec.Code)
		}
	}
	if n := fx.onlineJobs(t); n != 0 || fx.woken != 1 {
		t.Errorf("online jobs = %d, worker woken %d times; want none new", n, fx.woken)
	}

	if rec := fx.do("PUT", "/api/online", `{"youtube": true, "everything": true}`); rec.Code != http.StatusBadRequest {
		t.Errorf("unknown field: %d", rec.Code)
	}
	fx.who.Role = users.User
	for _, path := range []string{"/api/online", "/api/online/tmdb-key", "/api/online/tpdb-key"} {
		if rec := fx.do("PUT", path, `{}`); rec.Code != http.StatusForbidden {
			t.Errorf("normal user on %s: %d", path, rec.Code)
		}
	}
}

func TestAdministratorSavesTheTMDBKey(t *testing.T) {
	fx := newAdminFixture(t)

	// Without a key TMDB cannot be turned on.
	if rec := fx.do("PUT", "/api/online", `{"tmdb": true}`); rec.Code != http.StatusConflict {
		t.Errorf("TMDB on without a key = %d %s", rec.Code, rec.Body)
	}

	rec := fx.do("PUT", "/api/online/tmdb-key", `{"key": " `+testKey+` "}`)
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"youtube":false,"tmdb":false,"tpdb":false,"tmdbKey":true,"tpdbKey":false,"rules":{"from":0,"to":0,"daily":0,"order":["youtube","tmdb","tpdb"],"confirm":false},"askedToday":0,"proposals":0}` {
		t.Fatalf("save key = %d %s", rec.Code, rec.Body)
	}
	if got := fx.tm.asked[0]; got.URL.Path != "/3/authentication" || got.URL.Query().Get("api_key") != testKey {
		t.Errorf("key checked with %s", got.URL)
	}
	// TMDB is off: a key alone asks nothing.
	if n := fx.onlineJobs(t); n != 0 {
		t.Errorf("online jobs = %d with TMDB off", n)
	}
	// The key never comes back.
	if rec := fx.do("GET", "/api/online", ""); strings.Contains(rec.Body.String(), testKey) {
		t.Errorf("GET shows the key: %s", rec.Body)
	}

	if rec := fx.do("PUT", "/api/online", `{"tmdb": true}`); rec.Code != http.StatusOK || fx.onlineJobs(t) != 1 {
		t.Fatalf("TMDB on = %d %s, %d jobs", rec.Code, rec.Body, fx.onlineJobs(t))
	}

	// With TMDB on, a new key asks again about every video; the same key does not.
	fx.allDone(t)
	if rec := fx.do("PUT", "/api/online/tmdb-key", `{"key": "`+testKey+`"}`); rec.Code != http.StatusOK || fx.onlineJobs(t) != 0 {
		t.Errorf("same key = %d, %d jobs", rec.Code, fx.onlineJobs(t))
	}
	other := strings.Repeat("ab", 16)
	if rec := fx.do("PUT", "/api/online/tmdb-key", `{"key": "`+other+`"}`); rec.Code != http.StatusOK || fx.onlineJobs(t) != 1 {
		t.Errorf("new key = %d, %d jobs", rec.Code, fx.onlineJobs(t))
	}
	if fx.woken != 2 {
		t.Errorf("worker woken %d times, want 2", fx.woken)
	}
}

func TestAWrongTMDBKeyIsNotSaved(t *testing.T) {
	tests := []struct {
		name   string
		key    string
		answer func(http.ResponseWriter, *http.Request)
		want   int
	}{
		{"not the shape of a key", "my password", nil, http.StatusBadRequest},
		{"a header hidden in the key", testKey + "\r\nX-Evil: 1", nil, http.StatusBadRequest},
		{"empty", "", nil, http.StatusBadRequest},
		{"refused by TMDB", testKey, answer(http.StatusUnauthorized, `{"status_code": 7}`), http.StatusUnprocessableEntity},
		{"TMDB in trouble", testKey, answer(http.StatusServiceUnavailable, `{}`), http.StatusBadGateway},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fx := newAdminFixture(t)
			if tt.answer != nil {
				fx.tm.answers["/3/authentication"] = tt.answer
			}
			body, err := json.Marshal(map[string]string{"key": tt.key})
			if err != nil {
				t.Fatal(err)
			}
			if rec := fx.do("PUT", "/api/online/tmdb-key", string(body)); rec.Code != tt.want {
				t.Errorf("save key = %d %s, want %d", rec.Code, rec.Body, tt.want)
			}
			if tt.answer == nil && len(fx.tm.asked) != 0 {
				t.Errorf("a key with the wrong shape was sent to TMDB")
			}
			s, err := loadSettings(context.Background(), fx.db)
			if err != nil || s.tmdbKey != "" {
				t.Errorf("key saved: %q, %v", s.tmdbKey, err)
			}
		})
	}
}

func TestAdministratorSavesTheTPDBKey(t *testing.T) {
	fx := newAdminFixture(t)
	if rec := fx.do("PUT", "/api/online", `{"tpdb": true}`); rec.Code != http.StatusConflict {
		t.Errorf("ThePornDB on without a key = %d %s", rec.Code, rec.Body)
	}
	for body, want := range map[string]int{
		`{"key": "short"}`:                   http.StatusBadRequest,
		`{"key": "123|abc def ghi jkl mno"}`: http.StatusBadRequest,
	} {
		if rec := fx.do("PUT", "/api/online/tpdb-key", body); rec.Code != want {
			t.Errorf("save %s = %d, want %d", body, rec.Code, want)
		}
	}
	if len(fx.tp.asked) != 0 {
		t.Errorf("a key with the wrong shape was sent: %v", fx.tp.addresses())
	}

	fx.tp.answers["api.theporndb.net/scenes"] = answer(http.StatusUnauthorized, `{}`)
	if rec := fx.do("PUT", "/api/online/tpdb-key", `{"key": "`+testTPDBKey+`"}`); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("refused key = %d %s", rec.Code, rec.Body)
	}

	fx.tp.answers["api.theporndb.net/scenes"] = answer(http.StatusOK, `{"data": []}`)
	rec := fx.do("PUT", "/api/online/tpdb-key", `{"key": "`+testTPDBKey+`"}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"tpdbKey":true`) || strings.Contains(rec.Body.String(), testTPDBKey) {
		t.Fatalf("save key = %d %s", rec.Code, rec.Body)
	}
	// The key was tried with a fingerprint no file has.
	if got := fx.tp.asked[len(fx.tp.asked)-1]; got.URL.Query().Get("hash") != noHash {
		t.Errorf("key tried with %s", got.URL)
	}
	if rec := fx.do("PUT", "/api/online", `{"tpdb": true}`); rec.Code != http.StatusOK || fx.onlineJobs(t) != 1 {
		t.Errorf("ThePornDB on = %d %s, %d jobs", rec.Code, rec.Body, fx.onlineJobs(t))
	}
}
