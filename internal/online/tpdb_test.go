package online

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
)

// testTPDBKey has the shape of ThePornDB's keys.
const testTPDBKey = "123|AbCdEfGhIjKlMnOpQrStUv"

// The fingerprint of a file of 200 KiB of zeros: its size.
const zerosHash = "0000000000032000"

// fakeTPDB pretends to be ThePornDB, at its real addresses: the client it
// gives sends every address to it. Answers are set by host and path.
type fakeTPDB struct {
	mu      sync.Mutex
	asked   []*http.Request
	answers map[string]func(w http.ResponseWriter, r *http.Request)
}

func newFakeTPDB() *fakeTPDB {
	return &fakeTPDB{answers: map[string]func(http.ResponseWriter, *http.Request){
		"api.theporndb.net/scenes": answer(http.StatusOK, `{"data": [{"id": "x", "title": "Una scena",
			"description": "Che giornata.", "date": "2021-03-15", "site": {"name": "Uno Studio"},
			"background": {"large": "https://cdn.theporndb.net/wide.jpg"}}]}`),
		"cdn.theporndb.net/wide.jpg": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "image/jpeg")
			_, _ = w.Write([]byte("a scene picture"))
		},
	}}
}

// start serves the fake and returns a client that reaches it for any
// address. Only this test client skips checking the certificate.
func (f *fakeTPDB) start(t *testing.T) *http.Client {
	server := httptest.NewTLSServer(f)
	t.Cleanup(server.Close)
	return &http.Client{Transport: &http.Transport{
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
		},
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // a test server
	}}
}

func (f *fakeTPDB) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.asked = append(f.asked, r)
	f.mu.Unlock()
	if handle, ok := f.answers[r.Host+r.URL.Path]; ok {
		handle(w, r)
		return
	}
	http.NotFound(w, r)
}

func (f *fakeTPDB) addresses() []string {
	var all []string
	for _, r := range f.asked {
		all = append(all, r.Host+r.URL.Path)
	}
	return all
}

// turnTPDBOn turns ThePornDB on and puts the video's file in its folder.
func turnTPDBOn(t *testing.T, fx *fixture, file string) {
	t.Helper()
	if err := saveSources(context.Background(), fx.db, Sources{TPDB: true}); err != nil {
		t.Fatal(err)
	}
	if err := saveSetting(context.Background(), fx.db, keyTPDBKey, testTPDBKey); err != nil {
		t.Fatal(err)
	}
	full := filepath.Join(fx.library, filepath.FromSlash(file))
	if err := os.MkdirAll(filepath.Dir(full), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, make([]byte, 200<<10), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestTPDBGivesDetailsAndPicture(t *testing.T) {
	fx := newFixture(t, "varie/clip_0042.mp4", false)
	turnTPDBOn(t, fx, "varie/clip_0042.mp4")
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	got := fx.read(t)
	if got.title != "Una scena" || got.author.String != "Uno Studio" || !got.cover.Valid || got.coverJobs != 1 {
		t.Fatalf("video = %+v", got)
	}
	data, err := os.ReadFile(filepath.Join(fx.dataDir, Dir, got.cover.String))
	if err != nil || string(data) != "a scene picture" {
		t.Errorf("picture = %q, %v", data, err)
	}

	// Only the fingerprint was sent, with the key; the picture server got no key.
	if want := "api.theporndb.net/scenes cdn.theporndb.net/wide.jpg"; strings.Join(fx.tp.addresses(), " ") != want {
		t.Fatalf("asked %v, want %s", fx.tp.addresses(), want)
	}
	search := fx.tp.asked[0]
	if q := search.URL.Query(); q.Get("hash") != zerosHash || q.Get("hash_type") != "OSHASH" || len(q) != 2 {
		t.Errorf("search = %v", q)
	}
	if search.Header.Get("Authorization") != "Bearer "+testTPDBKey {
		t.Errorf("search Authorization = %q", search.Header.Get("Authorization"))
	}
	if got := fx.tp.asked[1].Header.Get("Authorization"); got != "" {
		t.Errorf("the key was sent to the picture server: %q", got)
	}

	// The video file was only read.
	if data, err := os.ReadFile(filepath.Join(fx.library, "varie", "clip_0042.mp4")); err != nil || len(data) != 200<<10 {
		t.Errorf("video file = %d bytes, %v", len(data), err)
	}
}

func TestTPDBNotSureClearsWhatWasThere(t *testing.T) {
	fx := newFixture(t, "clip.mp4", false)
	turnTPDBOn(t, fx, "clip.mp4")
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	fx.tp.asked = nil
	fx.tp.answers["api.theporndb.net/scenes"] = answer(http.StatusOK, `{"data": [{"title": "A"}, {"title": "B"}]}`)
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if got := fx.read(t); got.title != "dal nome" || got.cover.Valid || got.author.Valid {
		t.Errorf("video = %+v, want back to the name's title", got)
	}
	if len(fx.tp.asked) != 1 {
		t.Errorf("asked %v, want only the search", fx.tp.addresses())
	}
}

func TestTPDBRefusedKeyIsNotTriedAgain(t *testing.T) {
	fx := newFixture(t, "clip.mp4", false)
	turnTPDBOn(t, fx, "clip.mp4")
	fx.tp.answers["api.theporndb.net/scenes"] = answer(http.StatusUnauthorized, `{"message": "Unauthenticated."}`)
	err := fx.f.Handle(context.Background(), fx.id)
	if !errors.Is(err, jobs.ErrPermanent) || !errors.Is(err, errKeyRefused) || strings.Contains(err.Error(), testTPDBKey) {
		t.Errorf("error = %v, want a permanent errKeyRefused without the key", err)
	}
}

func TestTPDBWaitsForAMissingVideo(t *testing.T) {
	fx := newFixture(t, "clip.mp4", false)
	turnTPDBOn(t, fx, "clip.mp4")
	if _, err := fx.db.Exec(`UPDATE videos SET missing_since = 5`); err != nil {
		t.Fatal(err)
	}
	err := fx.f.Handle(context.Background(), fx.id)
	if !errors.Is(err, errVideoMissing) || errors.Is(err, jobs.ErrPermanent) {
		t.Errorf("error = %v, want one to try again later", err)
	}
	if len(fx.tp.asked) != 0 {
		t.Errorf("asked %v about a missing video", fx.tp.addresses())
	}
}

func TestTPDBTroubleIsTriedAgainLater(t *testing.T) {
	fx := newFixture(t, "clip.mp4", false)
	turnTPDBOn(t, fx, "clip.mp4")
	fx.tp.answers["api.theporndb.net/scenes"] = answer(http.StatusTooManyRequests, `{}`)
	err := fx.f.Handle(context.Background(), fx.id)
	if err == nil || errors.Is(err, jobs.ErrPermanent) {
		t.Errorf("error = %v, want one to try again later", err)
	}
}
