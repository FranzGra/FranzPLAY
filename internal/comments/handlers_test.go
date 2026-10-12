package comments

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/catalog"
	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// The people of the tests: Anna is the administrator.
const (
	anna   int64 = 1
	giulia int64 = 2
	marco  int64 = 3
)

type userKey struct{}

type site struct {
	db  *sql.DB
	mux *http.ServeMux
	now time.Time
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
	for _, q := range []string{
		`INSERT INTO libraries (id, path) VALUES (1, '/video')`,
		`INSERT INTO users (id, name, password_hash, role, created_at, avatar) VALUES
			(1, 'Anna', 'x', 'admin', 1, 0), (2, 'Giulia', 'x', 'user', 1, 42), (3, 'Marco', 'x', 'user', 1, 0)`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	s := &site{db: db, mux: http.NewServeMux(), now: time.Unix(1_000_000, 0)}
	handlers{
		store:  store{db: db},
		videos: catalog.NewLookup(db),
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		now:    func() time.Time { return s.now },
		account: func(ctx context.Context) (users.Account, bool) {
			id, ok := ctx.Value(userKey{}).(int64)
			role := users.Role("user")
			if id == anna {
				role = users.Admin
			}
			return users.Account{ID: id, Role: role}, ok
		},
	}.routes(s.mux)
	return s
}

func (s *site) addVideo(t *testing.T, name string) int64 {
	t.Helper()
	res, err := s.db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, folder_category, added_at)
		VALUES (?, 1, ?, 1, 1, ?, '', 1)`, "fp-"+name, name, name)
	if err != nil {
		t.Fatal(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func (s *site) do(t *testing.T, user int64, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if user != 0 {
		req = req.WithContext(context.WithValue(req.Context(), userKey{}, user))
	}
	rec := httptest.NewRecorder()
	s.mux.ServeHTTP(rec, req)
	return rec
}

func commentsOf(video int64) string {
	return "/api/videos/" + strconv.FormatInt(video, 10) + "/comments"
}

// write adds a comment as user and returns it.
func (s *site) write(t *testing.T, user, video int64, body string, parent int64) Comment {
	t.Helper()
	s.now = s.now.Add(time.Minute)
	payload, err := json.Marshal(addRequest{Body: body, ParentID: parent})
	if err != nil {
		t.Fatal(err)
	}
	rec := s.do(t, user, http.MethodPost, commentsOf(video), string(payload))
	if rec.Code != http.StatusCreated {
		t.Fatalf("write %q: %d %s", body, rec.Code, rec.Body)
	}
	return decode[Comment](t, rec)
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.NewDecoder(rec.Body).Decode(&v); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return v
}

func TestWriteAndRead(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "mare.mp4")
	other := s.addVideo(t, "montagna.mp4")

	first := s.write(t, giulia, video, "  Che bello!  ", 0)
	if first.Body != "Che bello!" || first.Author != (Author{ID: giulia, Name: "Giulia", Avatar: 42}) ||
		!first.CanDelete || !first.CreatedAt.Equal(time.Unix(1_000_060, 0)) {
		t.Errorf("first = %+v", first)
	}
	second := s.write(t, marco, video, "Bellissimo", 0)
	reply := s.write(t, marco, video, "Vero!", first.ID)
	// Answering a reply joins the same conversation.
	s.write(t, giulia, video, "Grazie", reply.ID)
	s.write(t, giulia, other, "Altro video", 0)

	got := decode[[]Comment](t, s.do(t, marco, http.MethodGet, commentsOf(video), ""))
	if len(got) != 2 || got[0].ID != second.ID || got[1].ID != first.ID {
		t.Fatalf("conversations = %+v", got)
	}
	if r := got[1].Replies; len(r) != 2 || r[0].Body != "Vero!" || r[1].Body != "Grazie" {
		t.Errorf("replies = %+v", r)
	}
	if !got[0].CanDelete || got[1].CanDelete {
		t.Errorf("Marco may delete only his own: %+v", got)
	}

	empty := s.do(t, marco, http.MethodGet, commentsOf(s.addVideo(t, "nuovo.mp4")), "")
	if body := strings.TrimSpace(empty.Body.String()); empty.Code != http.StatusOK || body != "[]" {
		t.Errorf("no comments: %d %s", empty.Code, body)
	}
}

func TestWriteRefused(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "mare.mp4")
	other := s.addVideo(t, "montagna.mp4")
	elsewhere := s.write(t, giulia, other, "là", 0)
	gone := s.addVideo(t, "via.mp4")
	if _, err := s.db.Exec(`UPDATE videos SET missing_since = 1 WHERE id = ?`, gone); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name   string
		user   int64
		target string
		body   string
		want   int
	}{
		{"nobody logged in", 0, commentsOf(video), `{"body":"ciao"}`, http.StatusUnauthorized},
		{"unknown video", giulia, commentsOf(999), `{"body":"ciao"}`, http.StatusNotFound},
		{"missing video", giulia, commentsOf(gone), `{"body":"ciao"}`, http.StatusNotFound},
		{"bad id", giulia, "/api/videos/x/comments", `{"body":"ciao"}`, http.StatusNotFound},
		{"empty", giulia, commentsOf(video), `{"body":"   "}`, http.StatusBadRequest},
		{"too long", giulia, commentsOf(video), `{"body":"` + strings.Repeat("a", maxLen+1) + `"}`, http.StatusBadRequest},
		{"not json", giulia, commentsOf(video), `ciao`, http.StatusBadRequest},
		{"other fields", giulia, commentsOf(video), `{"body":"ciao","userId":1}`, http.StatusBadRequest},
		{"unknown parent", giulia, commentsOf(video), `{"body":"ciao","parentId":999}`, http.StatusBadRequest},
		{"parent of another video", giulia, commentsOf(video), `{"body":"ciao","parentId":` + strconv.FormatInt(elsewhere.ID, 10) + `}`, http.StatusBadRequest},
	}
	for _, tt := range tests {
		if rec := s.do(t, tt.user, http.MethodPost, tt.target, tt.body); rec.Code != tt.want {
			t.Errorf("%s: %d %s, want %d", tt.name, rec.Code, rec.Body, tt.want)
		}
	}
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM comments`).Scan(&n); err != nil || n != 1 {
		t.Errorf("comments saved = %d (%v), want only the first", n, err)
	}
}

func TestDelete(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "mare.mp4")
	first := s.write(t, giulia, video, "primo", 0)
	s.write(t, marco, video, "risposta", first.ID)
	second := s.write(t, marco, video, "secondo", 0)
	path := func(id int64) string { return "/api/comments/" + strconv.FormatInt(id, 10) }

	if rec := s.do(t, marco, http.MethodDelete, path(first.ID), ""); rec.Code != http.StatusForbidden {
		t.Errorf("Marco deletes Giulia's: %d, want 403", rec.Code)
	}
	if rec := s.do(t, 0, http.MethodDelete, path(first.ID), ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("nobody logged in: %d", rec.Code)
	}
	if rec := s.do(t, marco, http.MethodDelete, path(999), ""); rec.Code != http.StatusNotFound {
		t.Errorf("unknown comment: %d", rec.Code)
	}
	// The author deletes a conversation: its replies go with it.
	if rec := s.do(t, giulia, http.MethodDelete, path(first.ID), ""); rec.Code != http.StatusNoContent {
		t.Fatalf("Giulia deletes hers: %d %s", rec.Code, rec.Body)
	}
	// The administrator can delete anything.
	if rec := s.do(t, anna, http.MethodDelete, path(second.ID), ""); rec.Code != http.StatusNoContent {
		t.Fatalf("Anna deletes Marco's: %d %s", rec.Code, rec.Body)
	}
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM comments`).Scan(&n); err != nil || n != 0 {
		t.Errorf("comments left = %d (%v), want 0", n, err)
	}
}

func TestCommentsOnASharedVideo(t *testing.T) {
	s := newSite(t)
	video := s.addVideo(t, "compleanno.mp4")
	for _, q := range []string{
		`UPDATE videos SET private = 1, uploaded_by = 2 WHERE id = ?`,
		`INSERT INTO video_shares (video_id, user_id) VALUES (?, 3)`,
	} {
		if _, err := s.db.Exec(q, video); err != nil {
			t.Fatal(err)
		}
	}
	// Giulia uploaded it and shared it with Marco: they talk about it.
	first := s.write(t, giulia, video, "Che bella festa!", 0)
	s.write(t, marco, video, "Bellissima!", first.ID)
	if got := decode[[]Comment](t, s.do(t, marco, http.MethodGet, commentsOf(video), "")); len(got) != 1 ||
		len(got[0].Replies) != 1 {
		t.Errorf("Marco reads %+v", got)
	}
	// Anna was not chosen: for her the video is not there.
	for _, r := range []struct{ method, body string }{{http.MethodGet, ""}, {http.MethodPost, `{"body":"Ciao"}`}} {
		if rec := s.do(t, anna, r.method, commentsOf(video), r.body); rec.Code != http.StatusNotFound {
			t.Errorf("Anna %s: %d, want 404", r.method, rec.Code)
		}
	}
}
