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

func TestAdministratorTurnsSourcesOn(t *testing.T) {
	fx := newFixture(t, "Gita [dQw4w9WgXcQ].mp4", false)
	if _, err := fx.db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, added_at, missing_since)
		VALUES ('fingerprint-2', 1, 'via.mp4', 1, 1, 'via', 1, 5)`); err != nil {
		t.Fatal(err)
	}
	woken := 0
	who := users.Account{ID: 1, Name: "Francesco", Role: users.Admin}
	a := api{db: fx.db, newJobs: func() { woken++ }, logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		now:     func() time.Time { return time.Unix(1000, 0) },
		account: func(context.Context) (users.Account, bool) { return who, true }}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/online", a.only(a.handleGet))
	mux.HandleFunc("PUT /api/online", a.only(a.handlePut))
	do := func(method, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(method, "/api/online", strings.NewReader(body)))
		return rec
	}
	onlineJobs := func() int {
		var n int
		if err := fx.db.QueryRow(`SELECT count(*) FROM jobs WHERE kind = 'online' AND state = 'pending'`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	if rec := do("GET", ""); rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"youtube":false}` {
		t.Fatalf("GET = %d %s", rec.Code, rec.Body)
	}
	if rec := do("PUT", `{"youtube": true}`); rec.Code != http.StatusOK {
		t.Fatalf("PUT = %d %s", rec.Code, rec.Body)
	}
	// Every video present is asked about once; the missing one is not.
	if n := onlineJobs(); n != 1 || woken != 1 {
		t.Errorf("online jobs = %d, worker woken %d times; want 1 and 1", n, woken)
	}
	var s Sources
	if rec := do("GET", ""); json.Unmarshal(rec.Body.Bytes(), &s) != nil || !s.YouTube {
		t.Errorf("after turning on: %s", rec.Body)
	}

	// Saving again, or turning off, asks nothing new.
	if _, err := fx.db.Exec(`UPDATE jobs SET state = 'done'`); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{`{"youtube": true}`, `{"youtube": false}`} {
		if rec := do("PUT", body); rec.Code != http.StatusOK {
			t.Fatalf("PUT %s = %d", body, rec.Code)
		}
	}
	if n := onlineJobs(); n != 0 || woken != 1 {
		t.Errorf("online jobs = %d, worker woken %d times; want none new", n, woken)
	}

	if rec := do("PUT", `{"youtube": true, "everything": true}`); rec.Code != http.StatusBadRequest {
		t.Errorf("unknown field: %d", rec.Code)
	}
	who.Role = users.User
	if rec := do("GET", ""); rec.Code != http.StatusForbidden {
		t.Errorf("normal user: %d", rec.Code)
	}
}
