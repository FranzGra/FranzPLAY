package sharing

import (
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

func TestPublicLinkOfAVideo(t *testing.T) {
	db := openDB(t) // marco admin (1), Anna (2) and Zoe (3) users
	if _, err := db.Exec(`INSERT INTO libraries (id, path) VALUES (1, '/v');
		INSERT INTO videos (id, fingerprint, library_id, path, size, mod_time, title, added_at, uploaded_by)
		VALUES (1, 'a', 1, 'anna.mp4', 1, 1, 't', 1, 2), (2, 'b', 1, 'cartella.mp4', 1, 1, 't', 1, NULL);
		UPDATE users SET can_share_public = 1 WHERE id = 2`); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	publicHandlers{db: db, logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		now: func() time.Time { return time.Unix(100, 0) }, account: users.FromContext}.routes(mux)
	as := func(a *users.Account, method, target string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, target, nil)
		if a != nil {
			req = req.WithContext(users.NewContext(req.Context(), *a))
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec
	}
	link := func(rec *httptest.ResponseRecorder) string {
		t.Helper()
		var got publicLinkResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("%d %s: %v", rec.Code, rec.Body, err)
		}
		if got.Link == nil {
			return ""
		}
		return *got.Link
	}
	anna := &users.Account{ID: 2, Role: users.User, CanSharePublic: true}
	zoe := &users.Account{ID: 3, Role: users.User}
	zoeAllowed := &users.Account{ID: 3, Role: users.User, CanSharePublic: true}
	marco := &users.Account{ID: 1, Role: users.Admin}

	// Off by default: no link.
	if got := link(as(anna, "GET", "/api/videos/1/public-link")); got != "" {
		t.Fatalf("a link before asking: %q", got)
	}
	first := link(as(anna, "POST", "/api/videos/1/public-link"))
	key, ok := strings.CutPrefix(first, "/p/")
	if !ok || !ValidKey(key) {
		t.Fatalf("link = %q", first)
	}
	// Again: a new key replaces the old one.
	second := link(as(anna, "POST", "/api/videos/1/public-link"))
	if second == first || link(as(anna, "GET", "/api/videos/1/public-link")) != second {
		t.Errorf("regenerate: %q then %q", first, second)
	}

	for name, tc := range map[string]struct {
		who    *users.Account
		method string
		target string
		want   int
	}{
		"nobody logged in":         {nil, "POST", "/api/videos/1/public-link", http.StatusUnauthorized},
		"without the permission":   {zoe, "POST", "/api/videos/1/public-link", http.StatusForbidden},
		"not her video":            {zoeAllowed, "POST", "/api/videos/1/public-link", http.StatusNotFound},
		"not her video, revoke":    {zoeAllowed, "DELETE", "/api/videos/1/public-link", http.StatusNotFound},
		"a folder video, a person": {anna, "POST", "/api/videos/2/public-link", http.StatusNotFound},
		"no such video":            {anna, "POST", "/api/videos/9/public-link", http.StatusNotFound},
		"admin, a folder video":    {marco, "POST", "/api/videos/2/public-link", http.StatusOK},
		"admin, someone's video":   {marco, "GET", "/api/videos/1/public-link", http.StatusOK},
	} {
		if rec := as(tc.who, tc.method, tc.target); rec.Code != tc.want {
			t.Errorf("%s: status %d, want %d", name, rec.Code, tc.want)
		}
	}

	// Revoked: no link, and the key is gone from the database.
	if rec := as(anna, "DELETE", "/api/videos/1/public-link"); rec.Code != http.StatusNoContent {
		t.Fatalf("revoke: status %d", rec.Code)
	}
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM public_links WHERE video_id = 1`).Scan(&n); err != nil || n != 0 {
		t.Errorf("links left for video 1: %d, %v", n, err)
	}
}
