package uploads

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/library"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

type userKey struct{}

// The people of the tests: Giulia may upload, Marco may not.
var (
	giulia = users.Account{ID: 1, Name: "Giulia", Role: users.User, CanUpload: true, UploadQuota: 1000}
	marco  = users.Account{ID: 2, Name: "Marco", Role: users.User, UploadQuota: 1000}
)

type site struct {
	db      *sql.DB
	data    string
	service *Service
	mux     *http.ServeMux
	clock   time.Time
	added   int
}

func newSite(t *testing.T) *site {
	t.Helper()
	data := t.TempDir()
	db, err := database.Open(context.Background(), data)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	if _, err := db.Exec(`INSERT INTO users (id, name, password_hash, role, created_at)
		VALUES (1, 'Giulia', 'x', 'user', 1), (2, 'Marco', 'x', 'user', 1)`); err != nil {
		t.Fatal(err)
	}
	service, err := NewService(db, data, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	s := &site{db: db, data: data, service: service, mux: http.NewServeMux(),
		clock: time.Date(2026, 10, 12, 20, 0, 0, 0, time.UTC)}
	service.now = func() time.Time { return s.clock }
	service.account = func(ctx context.Context) (users.Account, bool) {
		a, ok := ctx.Value(userKey{}).(users.Account)
		return a, ok
	}
	service.OnChange(func() { s.added++ })
	service.Routes(s.mux)
	return s
}

// do sends a request as a person; an empty account is nobody.
func (s *site) do(t *testing.T, who users.Account, method, target string, body io.Reader) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, body)
	if who.ID != 0 {
		req = req.WithContext(context.WithValue(req.Context(), userKey{}, who))
	}
	rec := httptest.NewRecorder()
	s.mux.ServeHTTP(rec, req)
	return rec
}

func (s *site) start(t *testing.T, who users.Account, name, title string, size int) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]any{"name": name, "title": title, "size": size})
	if err != nil {
		t.Fatal(err)
	}
	return s.do(t, who, "POST", "/api/uploads", bytes.NewReader(body))
}

// piece sends bytes of an upload, starting at offset.
func (s *site) piece(t *testing.T, who users.Account, id int64, offset int, content string) *httptest.ResponseRecorder {
	t.Helper()
	return s.do(t, who, "PUT", "/api/uploads/"+strconv.FormatInt(id, 10)+"?offset="+strconv.Itoa(offset),
		strings.NewReader(content))
}

func expect(t *testing.T, rec *httptest.ResponseRecorder, want int) {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("status %d, want %d: %s", rec.Code, want, rec.Body.String())
	}
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %s: %v", rec.Body.String(), err)
	}
	return v
}

func TestUploadArrivesInPiecesAndBecomesAVideo(t *testing.T) {
	s := newSite(t)
	content := "una gita al mare, in tre pezzi"
	rec := s.start(t, giulia, "mare.MP4", "Al mare", len(content))
	expect(t, rec, http.StatusCreated)
	u := decode[upload](t, rec)
	if u.Title != "Al mare" || u.Size != int64(len(content)) || u.Received != 0 {
		t.Fatalf("new upload = %+v", u)
	}

	expect(t, s.piece(t, giulia, u.ID, 0, content[:10]), http.StatusOK)
	got := decode[upload](t, s.piece(t, giulia, u.ID, 10, content[10:20]))
	if got.Received != 20 || got.Video != 0 {
		t.Fatalf("after two pieces = %+v", got)
	}
	if s.added != 0 {
		t.Error("a video was announced before the last piece")
	}

	rec = s.piece(t, giulia, u.ID, 20, content[20:])
	expect(t, rec, http.StatusOK)
	done := decode[upload](t, rec)
	if done.Video == 0 || done.Received != done.Size {
		t.Fatalf("after the last piece = %+v, want a video", done)
	}
	if s.added != 1 {
		t.Errorf("new video announced %d times, want 1", s.added)
	}

	// The file is in the uploads folder, in Giulia's folder, whole.
	folder, err := Folder(s.data)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := os.ReadFile(filepath.Join(folder, "1", strconv.FormatInt(u.ID, 10)+".mp4"))
	if err != nil || string(saved) != content {
		t.Fatalf("saved file = %q, %v; want the whole video", saved, err)
	}
	if left, _ := os.ReadDir(filepath.Join(s.data, incomingName)); len(left) != 0 {
		t.Errorf("incoming/ still has %d files", len(left))
	}

	// The catalog has it, as Giulia's, with her title, waiting to be read.
	var title, path string
	var by int64
	var probe string
	if err := s.db.QueryRow(`SELECT v.title, v.path, v.uploaded_by, j.state FROM videos v
		JOIN jobs j ON j.video_id = v.id AND j.kind = 'probe' WHERE v.id = ?`, done.Video).
		Scan(&title, &path, &by, &probe); err != nil {
		t.Fatal(err)
	}
	if title != "Al mare" || by != giulia.ID || probe != "pending" || path != "1/"+strconv.FormatInt(u.ID, 10)+".mp4" {
		t.Errorf("catalog has %q at %q by %d, probe %s", title, path, by, probe)
	}

	// The scanner, reading the uploads folder, finds it exactly as it is.
	scanner := library.NewScanner(s.db, []string{folder}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	report, err := scanner.Scan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if report != (library.Report{Unchanged: 1}) {
		t.Errorf("scan after the upload = %+v, want the video unchanged", report)
	}

	// The upload itself is over.
	if list := decode[mine](t, s.do(t, giulia, "GET", "/api/uploads", nil)); len(list.Uploads) != 0 ||
		list.Space.Used != int64(len(content)) {
		t.Errorf("after the upload: %+v", list)
	}
}

func TestUploadGoesOnAfterADroppedConnection(t *testing.T) {
	s := newSite(t)
	content := "0123456789abcdefghij"
	u := decode[upload](t, s.start(t, giulia, "a.mp4", "", len(content)))
	expect(t, s.piece(t, giulia, u.ID, 0, content[:8]), http.StatusOK)

	// The connection drops in the middle of the second piece: the server
	// gets fewer bytes than announced and counts none of them.
	req := httptest.NewRequest("PUT", "/api/uploads/"+strconv.FormatInt(u.ID, 10)+"?offset=8",
		io.MultiReader(strings.NewReader(content[8:11]), failing{}))
	req.ContentLength = 8
	req = req.WithContext(context.WithValue(req.Context(), userKey{}, giulia))
	rec := httptest.NewRecorder()
	s.mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("cut piece: status %d", rec.Code)
	}

	// The browser asks how much arrived, and goes on from there.
	list := decode[mine](t, s.do(t, giulia, "GET", "/api/uploads", nil))
	if len(list.Uploads) != 1 || list.Uploads[0].Received != 8 {
		t.Fatalf("after the cut: %+v, want 8 bytes received", list.Uploads)
	}
	// A piece sent again from the wrong place is refused.
	expect(t, s.piece(t, giulia, u.ID, 0, content[:8]), http.StatusConflict)
	expect(t, s.piece(t, giulia, u.ID, 8, content[8:]), http.StatusOK)

	folder, err := Folder(s.data)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := os.ReadFile(filepath.Join(folder, "1", strconv.FormatInt(u.ID, 10)+".mp4"))
	if err != nil || string(saved) != content {
		t.Errorf("saved file = %q, %v; want %q", saved, err, content)
	}
}

// failing is a body whose connection drops.
type failing struct{}

func (failing) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }

func TestUploadRefusals(t *testing.T) {
	s := newSite(t)
	u := decode[upload](t, s.start(t, giulia, "a.mp4", "", 10))

	for name, tc := range map[string]struct {
		rec  *httptest.ResponseRecorder
		want int
	}{
		"nobody":              {s.start(t, users.Account{}, "a.mp4", "", 10), http.StatusUnauthorized},
		"not allowed":         {s.start(t, marco, "a.mp4", "", 10), http.StatusForbidden},
		"not a video":         {s.start(t, giulia, "a.txt", "", 10), http.StatusBadRequest},
		"more than the quota": {s.start(t, giulia, "b.mp4", "", 991), http.StatusRequestEntityTooLarge},
		"unknown field": {
			s.do(t, giulia, "POST", "/api/uploads", strings.NewReader(`{"name":"a.mp4","size":1,"path":"/"}`)),
			http.StatusBadRequest,
		},
		"someone else's piece":  {s.piece(t, marco, u.ID, 0, "0123456789"), http.StatusNotFound},
		"someone else's cancel": {s.do(t, marco, "DELETE", "/api/uploads/"+strconv.FormatInt(u.ID, 10), nil), http.StatusNotFound},
		"no such upload":        {s.piece(t, giulia, 999, 0, "x"), http.StatusNotFound},
		"bad id":                {s.piece(t, giulia, -1, 0, "x"), http.StatusNotFound},
		"bad offset": {
			s.do(t, giulia, "PUT", "/api/uploads/"+strconv.FormatInt(u.ID, 10)+"?offset=abc", strings.NewReader("x")),
			http.StatusBadRequest,
		},
		"too long": {s.piece(t, giulia, u.ID, 0, "0123456789+"), http.StatusRequestEntityTooLarge},
	} {
		if tc.rec.Code != tc.want {
			t.Errorf("%s: status %d, want %d: %s", name, tc.rec.Code, tc.want, tc.rec.Body.String())
		}
	}

	// The quota counts the uploads not finished yet: 10 bytes are taken.
	expect(t, s.start(t, giulia, "b.mp4", "", 990), http.StatusCreated)
	expect(t, s.start(t, giulia, "c.mp4", "", 1), http.StatusRequestEntityTooLarge)
	sp := decode[mine](t, s.do(t, giulia, "GET", "/api/uploads", nil)).Space
	if sp != (Space{Quota: 1000, Reserved: 1000}) {
		t.Errorf("space = %+v", sp)
	}
}

func TestUploadsNeverShareAFile(t *testing.T) {
	s := newSite(t)
	first := decode[upload](t, s.start(t, giulia, "a.mp4", "", 5))
	expect(t, s.piece(t, giulia, first.ID, 0, "first"), http.StatusOK)
	// The table of uploads is empty again: the next number must still be new.
	second := decode[upload](t, s.start(t, giulia, "b.mp4", "", 6))
	if second.ID == first.ID {
		t.Fatalf("second upload got number %d again", first.ID)
	}
	expect(t, s.piece(t, giulia, second.ID, 0, "second"), http.StatusOK)

	folder, err := Folder(s.data)
	if err != nil {
		t.Fatal(err)
	}
	for id, want := range map[int64]string{first.ID: "first", second.ID: "second"} {
		got, err := os.ReadFile(filepath.Join(folder, "1", strconv.FormatInt(id, 10)+".mp4"))
		if err != nil || string(got) != want {
			t.Errorf("upload %d: file %q, %v; want %q", id, got, err, want)
		}
	}
}

func TestUploadNeverReplacesAFile(t *testing.T) {
	s := newSite(t)
	u := decode[upload](t, s.start(t, giulia, "a.mp4", "", 3))
	folder, err := Folder(s.data)
	if err != nil {
		t.Fatal(err)
	}
	// Something is already where the upload would go.
	there := filepath.Join(folder, "1", strconv.FormatInt(u.ID, 10)+".mp4")
	if err := os.MkdirAll(filepath.Dir(there), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(there, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	expect(t, s.piece(t, giulia, u.ID, 0, "new"), http.StatusInternalServerError)
	if got, _ := os.ReadFile(there); string(got) != "old" {
		t.Errorf("the file there is now %q", got)
	}
	// What arrived is kept: the upload can be finished once the place is free.
	if list := decode[mine](t, s.do(t, giulia, "GET", "/api/uploads", nil)); len(list.Uploads) != 1 ||
		list.Uploads[0].Received != 3 {
		t.Errorf("after the refusal: %+v", list.Uploads)
	}
}

func TestUploadOfAVideoAlreadyThere(t *testing.T) {
	s := newSite(t)
	first := decode[upload](t, s.start(t, giulia, "a.mp4", "", 5))
	expect(t, s.piece(t, giulia, first.ID, 0, "video"), http.StatusOK)

	second := decode[upload](t, s.start(t, giulia, "copia.mp4", "", 5))
	expect(t, s.piece(t, giulia, second.ID, 0, "video"), http.StatusConflict)

	var videos int
	if err := s.db.QueryRow(`SELECT count(*) FROM videos`).Scan(&videos); err != nil {
		t.Fatal(err)
	}
	if videos != 1 {
		t.Errorf("%d videos, want 1", videos)
	}
	// The copy is gone, and with it the space it took.
	list := decode[mine](t, s.do(t, giulia, "GET", "/api/uploads", nil))
	if len(list.Uploads) != 0 || list.Space.Reserved != 0 {
		t.Errorf("after the copy: %+v", list)
	}
	if left, _ := os.ReadDir(filepath.Join(s.data, incomingName)); len(left) != 0 {
		t.Errorf("incoming/ still has %d files", len(left))
	}
}

func TestCancelAnUpload(t *testing.T) {
	s := newSite(t)
	u := decode[upload](t, s.start(t, giulia, "a.mp4", "", 10))
	expect(t, s.piece(t, giulia, u.ID, 0, "01234"), http.StatusOK)

	expect(t, s.do(t, giulia, "DELETE", "/api/uploads/"+strconv.FormatInt(u.ID, 10), nil), http.StatusNoContent)
	if left, _ := os.ReadDir(filepath.Join(s.data, incomingName)); len(left) != 0 {
		t.Errorf("incoming/ still has %d files", len(left))
	}
	expect(t, s.piece(t, giulia, u.ID, 5, "56789"), http.StatusNotFound)
}

func TestCleanForgetsAbandonedUploads(t *testing.T) {
	s := newSite(t)
	old := decode[upload](t, s.start(t, giulia, "old.mp4", "", 10))
	s.clock = s.clock.Add(ForgetAfter / 2)
	recent := decode[upload](t, s.start(t, giulia, "recent.mp4", "", 10))
	// A file nobody waits for, like the one of a person who was removed.
	incoming := filepath.Join(s.data, incomingName)
	if err := os.WriteFile(filepath.Join(incoming, "999.part"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}

	s.clock = s.clock.Add(ForgetAfter/2 + time.Hour)
	n, err := s.service.Clean(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Errorf("removed %d files, want 2", n)
	}
	list := decode[mine](t, s.do(t, giulia, "GET", "/api/uploads", nil))
	if len(list.Uploads) != 1 || list.Uploads[0].ID != recent.ID {
		t.Errorf("after cleaning: %+v, want only the recent upload", list.Uploads)
	}
	for _, name := range []string{partName(old.ID), "999.part"} {
		if _, err := os.Stat(filepath.Join(incoming, name)); !os.IsNotExist(err) {
			t.Errorf("%s still there: %v", name, err)
		}
	}
	if _, err := os.Stat(filepath.Join(incoming, partName(recent.ID))); err != nil {
		t.Errorf("the recent upload lost its file: %v", err)
	}
}
