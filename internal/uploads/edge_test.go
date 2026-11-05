package uploads

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// TestCheckDangerousNames: whatever name the browser sends, only the last
// part of it is kept, and it never decides where the file goes.
func TestCheckDangerousNames(t *testing.T) {
	uploader := users.Account{ID: 7, CanUpload: true, UploadQuota: 1000}
	room := Space{Quota: 1000}
	for name, tc := range map[string]struct {
		in   string
		want string
		err  error
	}{
		"climbs with slashes":        {"../../etc/passwd.mp4", "passwd.mp4", nil},
		"climbs with backslashes":    {`..\..\Windows\System32\x.mkv`, "x.mkv", nil},
		"absolute unix path":         {"/root/.ssh/a.webm", "a.webm", nil},
		"windows drive":              {`D:\Video\mare.mov`, "mare.mov", nil},
		"unc path":                   {`\\server\share\film.mp4`, "film.mp4", nil},
		"reserved windows name":      {"CON.mp4", "CON.mp4", nil},
		"accents and emoji":          {"Perché 🎬 è così.mp4", "Perché 🎬 è così.mp4", nil},
		"spaces around":              {"  mare.mp4\t", "mare.mp4", nil},
		"exactly 255 characters":     {strings.Repeat("è", 251) + ".mp4", strings.Repeat("è", 251) + ".mp4", nil},
		"256 characters":             {strings.Repeat("è", 252) + ".mp4", "", errBadName},
		"only dots":                  {"..", "", errNotVideo},
		"ends in a slash":            {"video/", "video", errNotVideo},
		"nul":                        {"a\x00.mp4", "", errBadName},
		"tab inside":                 {"a\tb.mp4", "", errBadName},
		"not utf-8":                  {"\xff\xfe.mp4", "", errBadName},
		"video extension in the dir": {"film.mp4/run.sh", "", errNotVideo},
		"double extension":           {"film.mp4.exe", "", errNotVideo},
	} {
		got, err := check(uploader, newUpload{Name: tc.in, Title: "Titolo", Size: 1}, room, 0)
		if !errors.Is(err, tc.err) {
			t.Errorf("%s: err = %v, want %v", name, err, tc.err)
			continue
		}
		if err == nil && got.Name != tc.want {
			t.Errorf("%s: name = %q, want %q", name, got.Name, tc.want)
		}
	}
}

// TestCheckLongNameWithoutTitle: a name may be 255 characters, a title 200.
// Without a title the name is used, so a long name must still be accepted.
func TestCheckLongNameWithoutTitle(t *testing.T) {
	uploader := users.Account{ID: 7, CanUpload: true, UploadQuota: 1000}
	name := strings.Repeat("a", 220) + ".mp4"
	got, err := check(uploader, newUpload{Name: name, Size: 1}, Space{Quota: 1000}, 0)
	if err != nil {
		t.Fatalf("check = %v, want the upload accepted", err)
	}
	if n := len([]rune(got.Title)); n == 0 || n > maxTitle {
		t.Errorf("title of %d characters", n)
	}
	// Cut by characters, never in the middle of one.
	got, err = check(uploader, newUpload{Name: strings.Repeat("è", 220) + ".mp4", Size: 1}, Space{Quota: 1000}, 0)
	if err != nil || got.Title != strings.Repeat("è", maxTitle) {
		t.Errorf("accented name: title %q, %v", got.Title, err)
	}
}

func TestCheckSpaceLimits(t *testing.T) {
	uploader := users.Account{ID: 7, CanUpload: true, UploadQuota: 1000}
	room := Space{Quota: 1000, Used: 400, Reserved: 100}
	if _, err := check(uploader, newUpload{Name: "a.mp4", Size: 500}, room, maxWaiting-1); err != nil {
		t.Errorf("exactly the space left, last upload allowed: %v", err)
	}
	if _, err := check(uploader, newUpload{Name: "a.mp4", Size: 501}, room, 0); !errors.Is(err, errNoSpace) {
		t.Errorf("one byte more: %v, want errNoSpace", err)
	}
	if _, err := check(uploader, newUpload{Name: "a.mp4", Size: 1}, Space{}, 0); !errors.Is(err, errNoSpace) {
		t.Errorf("no quota: %v, want errNoSpace", err)
	}
}

// TestUploadWithADangerousNameStaysInItsFolder: a whole upload whose name
// tries to climb out ends in the person's folder, with a number for name.
func TestUploadWithADangerousNameStaysInItsFolder(t *testing.T) {
	s := newSite(t)
	outside := filepath.Dir(s.data)
	before, err := os.ReadDir(outside)
	if err != nil {
		t.Fatal(err)
	}
	u := decode[upload](t, s.start(t, giulia, `..\..\..\evil.MP4`, "", 4))
	if u.Name != "evil.MP4" {
		t.Errorf("name = %q", u.Name)
	}
	done := decode[upload](t, s.piece(t, giulia, u.ID, 0, "evil"))
	if done.Video == 0 {
		t.Fatal("the upload did not become a video")
	}
	folder, err := Folder(content.Root(s.data))
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(folder, "1", strconv.FormatInt(u.ID, 10)+".mp4")
	if got, err := os.ReadFile(want); err != nil || string(got) != "evil" {
		t.Errorf("file %s = %q, %v", want, got, err)
	}
	after, err := os.ReadDir(outside)
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(before) {
		t.Errorf("files next to the data folder changed: %d before, %d after", len(before), len(after))
	}
	var path string
	if err := s.db.QueryRow(`SELECT path FROM videos WHERE id = ?`, done.Video).Scan(&path); err != nil || path != "1/"+strconv.FormatInt(u.ID, 10)+".mp4" {
		t.Errorf("path in the catalog = %q, %v", path, err)
	}
}

// blockingBody is a piece whose bytes arrive only when released.
type blockingBody struct {
	reading chan struct{}
	release chan struct{}
	data    io.Reader
}

func (b *blockingBody) Read(p []byte) (int, error) {
	if b.reading != nil {
		close(b.reading)
		b.reading = nil
		<-b.release
	}
	return b.data.Read(p)
}

// TestTwoPiecesAtOnce: while a piece is arriving, another one for the same
// upload (a browser that sent it twice) is refused, and the file is right.
func TestTwoPiecesAtOnce(t *testing.T) {
	s := newSite(t)
	u := decode[upload](t, s.start(t, giulia, "a.mp4", "", 10))
	body := &blockingBody{reading: make(chan struct{}), release: make(chan struct{}), data: strings.NewReader("01234")}
	reading := body.reading

	first := make(chan *httptest.ResponseRecorder)
	go func() {
		req := httptest.NewRequest("PUT", "/api/uploads/"+strconv.FormatInt(u.ID, 10)+"?offset=0", body)
		req.ContentLength = 5
		req = req.WithContext(context.WithValue(req.Context(), userKey{}, giulia))
		rec := httptest.NewRecorder()
		s.mux.ServeHTTP(rec, req)
		first <- rec
	}()
	select {
	case <-reading:
	case <-time.After(10 * time.Second):
		t.Fatal("the first piece never started")
	}
	rec := s.piece(t, giulia, u.ID, 0, "01234")
	expect(t, rec, http.StatusConflict)
	if !strings.Contains(rec.Body.String(), errBusy.Error()) {
		t.Errorf("second piece: %s, want %q", rec.Body.String(), errBusy)
	}
	// Cancelling now is refused too: the file is being written.
	expect(t, s.do(t, giulia, "DELETE", "/api/uploads/"+strconv.FormatInt(u.ID, 10), nil), http.StatusConflict)
	close(body.release)
	expect(t, <-first, http.StatusOK)

	expect(t, s.piece(t, giulia, u.ID, 5, "56789"), http.StatusOK)
	folder, err := Folder(content.Root(s.data))
	if err != nil {
		t.Fatal(err)
	}
	if got, err := os.ReadFile(filepath.Join(folder, "1", strconv.FormatInt(u.ID, 10)+".mp4")); err != nil || string(got) != "0123456789" {
		t.Errorf("file = %q, %v", got, err)
	}
}

func TestPieceSizeRules(t *testing.T) {
	s := newSite(t)
	big := giulia
	big.UploadQuota = 1 << 40
	u := decode[upload](t, s.start(t, big, "a.mp4", "", MaxPiece+10))
	target := "/api/uploads/" + strconv.FormatInt(u.ID, 10) + "?offset=0"
	send := func(body io.Reader, length int64) *httptest.ResponseRecorder {
		req := httptest.NewRequest("PUT", target, body)
		req.ContentLength = length
		req = req.WithContext(context.WithValue(req.Context(), userKey{}, big))
		rec := httptest.NewRecorder()
		s.mux.ServeHTTP(rec, req)
		return rec
	}
	// Refused before a byte is read: the body would fail if read.
	expect(t, send(failing{}, MaxPiece+1), http.StatusRequestEntityTooLarge)
	// A body sent in chunks, without its size, cannot be checked.
	expect(t, send(strings.NewReader("abc"), -1), http.StatusLengthRequired)
	// A body longer than announced: only the announced bytes count.
	rec := send(strings.NewReader("abcdefgh"), 3)
	expect(t, rec, http.StatusOK)
	if got := decode[upload](t, rec); got.Received != 3 {
		t.Errorf("received = %d, want 3", got.Received)
	}
	if data, err := os.ReadFile(filepath.Join(content.Root(s.data).Incoming(), partName(u.ID))); err != nil || string(data) != "abc" {
		t.Errorf("file = %q, %v", data, err)
	}
	// An offset past the end, or negative.
	expect(t, s.do(t, big, "PUT", "/api/uploads/"+strconv.FormatInt(u.ID, 10)+"?offset=-1", strings.NewReader("x")), http.StatusBadRequest)
	expect(t, s.piece(t, big, u.ID, 99, "x"), http.StatusConflict)
}

// TestCleanLeavesWhatIsNotAnUpload: incoming/ may hold things FranzPLAY did
// not write there; Clean removes stray files but never a folder.
func TestCleanLeavesWhatIsNotAnUpload(t *testing.T) {
	s := newSite(t)
	u := decode[upload](t, s.start(t, giulia, "a.mp4", "", 10))
	incoming := content.Root(s.data).Incoming()
	for _, name := range []string{"abc.part", "12", ".DS_Store", "-1.part"} {
		if err := os.WriteFile(filepath.Join(incoming, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(incoming, "7.part"), 0o750); err != nil {
		t.Fatal(err)
	}
	n, err := s.service.Clean(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if n != 4 {
		t.Errorf("removed %d files, want 4", n)
	}
	entries, err := os.ReadDir(incoming)
	if err != nil {
		t.Fatal(err)
	}
	var left []string
	for _, e := range entries {
		left = append(left, e.Name())
	}
	slices.Sort(left)
	if want := []string{partName(u.ID), "7.part"}; !slices.Equal(left, want) {
		t.Errorf("left %q, want %q", left, want)
	}
}
