package online

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/jobs"
)

// fakeYouTube pretends to be YouTube. It answers with what the test sets
// and remembers what it was asked.
type fakeYouTube struct {
	mu       sync.Mutex
	asked    []string
	oEmbed   func(w http.ResponseWriter, r *http.Request)
	pictures map[string][]byte // by name, like "hqdefault.jpg"
}

func (f *fakeYouTube) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.asked = append(f.asked, r.URL.String())
	f.mu.Unlock()
	if r.URL.Path == "/oembed" {
		f.oEmbed(w, r)
		return
	}
	if data, ok := f.pictures[filepath.Base(r.URL.Path)]; ok {
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write(data)
		return
	}
	http.NotFound(w, r)
}

func answer(status int, body string) func(w http.ResponseWriter, r *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}
}

type fixture struct {
	db      *sql.DB
	id      int64
	dataDir string
	yt      *fakeYouTube
	f       *Fetcher
}

func newFixture(t *testing.T, file string, youtubeOn bool) *fixture {
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
	if _, err := db.Exec(`INSERT INTO libraries (id, path) VALUES (1, ?)`, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	res, err := db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, added_at)
		VALUES ('fingerprint-1', 1, ?, 1, 1, 'dal nome', 1)`, file)
	if err != nil {
		t.Fatal(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if err := saveSources(context.Background(), db, Sources{YouTube: youtubeOn}); err != nil {
		t.Fatal(err)
	}
	yt := &fakeYouTube{
		oEmbed:   answer(http.StatusOK, `{"title": "Gita in montagna", "author_name": "Famiglia Rossi"}`),
		pictures: map[string][]byte{"hqdefault.jpg": []byte("a jpeg")},
	}
	server := httptest.NewServer(yt)
	t.Cleanup(server.Close)
	dataDir := t.TempDir()
	f := NewFetcher(db, dataDir)
	f.youtube.oEmbed = server.URL + "/oembed"
	f.youtube.images = server.URL + "/vi"
	return &fixture{db: db, id: id, dataDir: dataDir, yt: yt, f: f}
}

type shown struct {
	title         string
	author, cover sql.NullString
	onlineTitle   sql.NullString
	coverJobs     int
}

func (fx *fixture) read(t *testing.T) shown {
	t.Helper()
	var s shown
	if err := fx.db.QueryRow(`SELECT shown_title, shown_author, online_cover, online_title,
		(SELECT count(*) FROM jobs WHERE video_id = videos.id AND kind = 'cover' AND state = 'pending')
		FROM videos WHERE id = ?`, fx.id).Scan(&s.title, &s.author, &s.cover, &s.onlineTitle, &s.coverJobs); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestNothingIsAskedWhileOff(t *testing.T) {
	fx := newFixture(t, "Gita [dQw4w9WgXcQ].mp4", false)
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if len(fx.yt.asked) != 0 {
		t.Errorf("asked %v with every source off", fx.yt.asked)
	}
	if got := fx.read(t); got.title != "dal nome" || got.onlineTitle.Valid {
		t.Errorf("video = %+v", got)
	}
}

func TestYouTubeGivesTitleAuthorAndPicture(t *testing.T) {
	fx := newFixture(t, "canale/Gita [dQw4w9WgXcQ].mp4", true)
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	got := fx.read(t)
	if got.title != "Gita in montagna" || got.author.String != "Famiglia Rossi" || !got.cover.Valid {
		t.Fatalf("video = %+v", got)
	}
	if got.coverJobs != 1 {
		t.Errorf("cover jobs = %d, want the cover made again from the picture", got.coverJobs)
	}
	data, err := os.ReadFile(filepath.Join(fx.dataDir, Dir, got.cover.String))
	if err != nil || string(data) != "a jpeg" {
		t.Errorf("picture = %q, %v", data, err)
	}
	// Only the code of the video was sent: the biggest cover first, then the next.
	want := []string{
		"/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ",
		"/vi/dQw4w9WgXcQ/maxresdefault.jpg",
		"/vi/dQw4w9WgXcQ/hqdefault.jpg",
	}
	if len(fx.yt.asked) != len(want) {
		t.Fatalf("asked %v, want %v", fx.yt.asked, want)
	}
	for i := range want {
		if fx.yt.asked[i] != want[i] {
			t.Errorf("question %d = %q, want %q", i, fx.yt.asked[i], want[i])
		}
	}

	// A file next to the video wins over the internet.
	if _, err := fx.db.Exec(`UPDATE videos SET details_title = 'Dal file', author = 'Nonna' WHERE id = ?`, fx.id); err != nil {
		t.Fatal(err)
	}
	if got := fx.read(t); got.title != "Dal file" || got.author.String != "Nonna" {
		t.Errorf("with a details file = %+v", got)
	}
}

func TestYouTubeNoLongerKnowsTheVideo(t *testing.T) {
	fx := newFixture(t, "Gita [dQw4w9WgXcQ].mp4", true)
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	before := fx.read(t)
	if _, err := fx.db.Exec(`UPDATE jobs SET state = 'done'`); err != nil {
		t.Fatal(err)
	}

	fx.yt.oEmbed = answer(http.StatusNotFound, `Not Found`)
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	got := fx.read(t)
	if got.title != "dal nome" || got.author.Valid || got.cover.Valid || got.coverJobs != 1 {
		t.Errorf("video = %+v, want back to the name's title and a cover made again", got)
	}
	if _, err := os.Stat(filepath.Join(fx.dataDir, Dir, before.cover.String)); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("old picture still there: %v", err)
	}
}

func TestYouTubeTroubleIsTriedAgainLater(t *testing.T) {
	for name, oEmbed := range map[string]func(http.ResponseWriter, *http.Request){
		"too many questions": answer(http.StatusTooManyRequests, `{}`),
		"server trouble":     answer(http.StatusBadGateway, `{}`),
		"a web page": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte("<html>"))
		},
	} {
		t.Run(name, func(t *testing.T) {
			fx := newFixture(t, "Gita [dQw4w9WgXcQ].mp4", true)
			fx.yt.oEmbed = oEmbed
			err := fx.f.Handle(context.Background(), fx.id)
			if err == nil || errors.Is(err, jobs.ErrPermanent) {
				t.Errorf("error = %v, want one to try again later", err)
			}
			if got := fx.read(t); got.onlineTitle.Valid {
				t.Errorf("video = %+v", got)
			}
		})
	}
}

func TestNoYouTubeCodeNoQuestion(t *testing.T) {
	fx := newFixture(t, "mare.mp4", true)
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if len(fx.yt.asked) != 0 {
		t.Errorf("asked %v about a video without a YouTube code", fx.yt.asked)
	}
}

func TestPictureThatIsNotOneIsRefused(t *testing.T) {
	fx := newFixture(t, "Gita [dQw4w9WgXcQ].mp4", true)
	fx.yt.pictures = nil
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oembed" {
			answer(http.StatusOK, `{"title": "x"}`)(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<html>"))
	}))
	defer server.Close()
	fx.f.youtube.oEmbed = server.URL + "/oembed"
	fx.f.youtube.images = server.URL + "/vi"
	if err := fx.f.Handle(context.Background(), fx.id); !errors.Is(err, errWrongContent) {
		t.Errorf("error = %v, want errWrongContent", err)
	}
}

func TestRemoveOrphans(t *testing.T) {
	fx := newFixture(t, "Gita [dQw4w9WgXcQ].mp4", true)
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(fx.dataDir, Dir)
	for _, name := range []string{"99-old.img", ".new-123"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	n, err := RemoveOrphans(context.Background(), fx.db, fx.dataDir)
	if err != nil || n != 2 {
		t.Fatalf("removed %d, %v; want 2", n, err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 || entries[0].Name() != fx.read(t).cover.String {
		t.Errorf("left %v, %v; want only the picture in use", entries, err)
	}
}
