package online

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
)

// testKey has the shape of TMDB's short key.
const testKey = "0123456789abcdef0123456789abcdef"

// fakeTMDB pretends to be TMDB. Its answers are set by path, with the
// search's language after a "?": "/3/search/movie?it-IT".
type fakeTMDB struct {
	mu      sync.Mutex
	asked   []*http.Request
	answers map[string]func(w http.ResponseWriter, r *http.Request)
}

func newFakeTMDB() *fakeTMDB {
	return &fakeTMDB{answers: map[string]func(http.ResponseWriter, *http.Request){
		"/3/search/movie?it-IT": answer(http.StatusOK, `{"results": [
			{"id": 5, "title": "Il sorpasso", "original_title": "Il sorpasso", "release_date": "2020-05-01"},
			{"id": 6, "title": "Il sorpasso", "original_title": "Il sorpasso", "release_date": "1962-12-05"}]}`),
		"/3/movie/6": answer(http.StatusOK, `{"title": "Il sorpasso", "overview": "Due uomini in viaggio.",
			"release_date": "1962-12-05", "backdrop_path": "/wide.jpg",
			"credits": {"crew": [{"job": "Director", "name": "Dino Risi"}]}}`),
		"/3/authentication": answer(http.StatusOK, `{"success": true}`),
		"/t/p/w1280/wide.jpg": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "image/jpeg")
			_, _ = w.Write([]byte("a film picture"))
		},
	}}
}

func (f *fakeTMDB) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.asked = append(f.asked, r)
	f.mu.Unlock()
	name := r.URL.Path
	if language := r.URL.Query().Get("language"); name == "/3/search/movie" {
		name += "?" + language
	}
	if handle, ok := f.answers[name]; ok {
		handle(w, r)
		return
	}
	answer(http.StatusNotFound, `{"success": false}`)(w, r)
}

func (f *fakeTMDB) paths() []string {
	var paths []string
	for _, r := range f.asked {
		paths = append(paths, r.URL.Path)
	}
	return paths
}

func turnTMDBOn(t *testing.T, fx *fixture) {
	t.Helper()
	if err := saveSources(context.Background(), fx.db, Sources{TMDB: true}); err != nil {
		t.Fatal(err)
	}
	if err := saveSetting(context.Background(), fx.db, keyTMDBKey, testKey); err != nil {
		t.Fatal(err)
	}
}

func TestTMDBGivesFilmDetailsAndPicture(t *testing.T) {
	fx := newFixture(t, "film/Il.sorpasso.1962.1080p.mkv", false)
	turnTMDBOn(t, fx)
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	got := fx.read(t)
	if got.title != "Il sorpasso" || got.author.String != "Dino Risi" || !got.cover.Valid || got.coverJobs != 1 {
		t.Fatalf("video = %+v", got)
	}
	data, err := os.ReadFile(filepath.Join(fx.dataDir, Dir, got.cover.String))
	if err != nil || string(data) != "a film picture" {
		t.Errorf("picture = %q, %v", data, err)
	}

	// Only the title and the year were sent, with the short key in the address.
	if want := []string{"/3/search/movie", "/3/movie/6", "/t/p/w1280/wide.jpg"}; strings.Join(fx.tm.paths(), " ") != strings.Join(want, " ") {
		t.Fatalf("asked %v, want %v", fx.tm.paths(), want)
	}
	search := fx.tm.asked[0].URL.Query()
	if search.Get("query") != "Il sorpasso" || search.Get("primary_release_year") != "1962" || search.Get("api_key") != testKey {
		t.Errorf("search = %v", search)
	}
	if got := fx.tm.asked[1].URL.Query().Get("append_to_response"); got != "credits" {
		t.Errorf("film asked without its credits: %q", got)
	}
	if fx.tm.asked[2].URL.Query().Has("api_key") {
		t.Error("the key was sent to the picture server")
	}
}

func TestTMDBLongKeyGoesInAHeader(t *testing.T) {
	fx := newFixture(t, "Il sorpasso (1962).mkv", false)
	turnTMDBOn(t, fx)
	token := "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.c2lnbmF0dXJl"
	if err := saveSetting(context.Background(), fx.db, keyTMDBKey, token); err != nil {
		t.Fatal(err)
	}
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	first := fx.tm.asked[0]
	if first.Header.Get("Authorization") != "Bearer "+token || first.URL.Query().Has("api_key") {
		t.Errorf("asked %s with Authorization %q", first.URL, first.Header.Get("Authorization"))
	}
}

func TestTMDBSearchesInEnglishToo(t *testing.T) {
	fx := newFixture(t, "The Matrix (1999).mkv", false)
	turnTMDBOn(t, fx)
	fx.tm.answers["/3/search/movie?it-IT"] = answer(http.StatusOK, `{"results": [
		{"id": 9, "title": "Matrix", "original_title": "Matrix", "release_date": "1999-03-30"}]}`)
	fx.tm.answers["/3/search/movie?en-US"] = answer(http.StatusOK, `{"results": [
		{"id": 6, "title": "The Matrix", "original_title": "The Matrix", "release_date": "1999-03-30"}]}`)
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(fx.tm.paths(), " "); !strings.HasPrefix(got, "/3/search/movie /3/search/movie /3/movie/6") {
		t.Errorf("asked %s", got)
	}
	if got := fx.read(t); got.onlineTitle.String != "Il sorpasso" {
		t.Errorf("video = %+v, want the details of film 6", got)
	}
}

func TestTMDBNoSureFilmClearsWhatWasThere(t *testing.T) {
	fx := newFixture(t, "Il sorpasso (1962).mkv", false)
	turnTMDBOn(t, fx)
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.db.Exec(`UPDATE videos SET path = 'Gita al mare 2019.mp4'`); err != nil {
		t.Fatal(err)
	}
	fx.tm.asked = nil
	// A film with the same name but another year is not this video.
	fx.tm.answers["/3/search/movie?it-IT"] = answer(http.StatusOK, `{"results": [
		{"id": 6, "title": "Gita al mare", "original_title": "Gita al mare", "release_date": "1990-01-01"}]}`)
	if err := fx.f.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(fx.tm.paths(), " "); got != "/3/search/movie /3/search/movie" {
		t.Errorf("asked %s, want only the two searches", got)
	}
	if got := fx.read(t); got.title != "dal nome" || got.cover.Valid || got.author.Valid {
		t.Errorf("video = %+v, want back to the name's title", got)
	}
}

func TestTMDBRefusedKeyIsNotTriedAgain(t *testing.T) {
	fx := newFixture(t, "Il sorpasso (1962).mkv", false)
	turnTMDBOn(t, fx)
	fx.tm.answers["/3/search/movie?it-IT"] = answer(http.StatusUnauthorized, `{"status_code": 7}`)
	err := fx.f.Handle(context.Background(), fx.id)
	if !errors.Is(err, jobs.ErrPermanent) || !errors.Is(err, errKeyRefused) {
		t.Errorf("error = %v, want a permanent errKeyRefused", err)
	}
	if strings.Contains(err.Error(), testKey) {
		t.Errorf("the key is in the error: %v", err)
	}
}

func TestTMDBTroubleIsTriedAgainLater(t *testing.T) {
	fx := newFixture(t, "Il sorpasso (1962).mkv", false)
	turnTMDBOn(t, fx)
	fx.tm.answers["/3/movie/6"] = answer(http.StatusTooManyRequests, `{}`)
	err := fx.f.Handle(context.Background(), fx.id)
	if err == nil || errors.Is(err, jobs.ErrPermanent) {
		t.Errorf("error = %v, want one to try again later", err)
	}
}

func TestTMDBNetworkErrorHidesTheKey(t *testing.T) {
	fx := newFixture(t, "Il sorpasso (1962).mkv", false)
	turnTMDBOn(t, fx)
	fx.f.tmdb.api = "http://127.0.0.1:1/3" // nobody answers there
	err := fx.f.Handle(context.Background(), fx.id)
	if err == nil || strings.Contains(err.Error(), testKey) {
		t.Errorf("error = %v, want one without the key", err)
	}
}

func TestEachVideoGoesToItsOwnSource(t *testing.T) {
	tests := []struct {
		name    string
		file    string
		sources Sources
		key     string
	}{
		{"a YouTube video, YouTube off", "Gita 1999 [dQw4w9WgXcQ].mp4", Sources{TMDB: true}, testKey},
		{"a film, TMDB off", "Il sorpasso (1962).mkv", Sources{YouTube: true}, testKey},
		{"a film, TMDB on without a key", "Il sorpasso (1962).mkv", Sources{TMDB: true}, ""},
		{"another video, ThePornDB off", "clip.mp4", Sources{YouTube: true, TMDB: true}, testKey},
		{"another video, ThePornDB on without a key", "clip.mp4", Sources{TPDB: true}, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fx := newFixture(t, tt.file, false)
			if _, err := fx.db.Exec(`UPDATE videos SET online_title = 'trovato prima'`); err != nil {
				t.Fatal(err)
			}
			if err := saveSources(context.Background(), fx.db, tt.sources); err != nil {
				t.Fatal(err)
			}
			if err := saveSetting(context.Background(), fx.db, keyTMDBKey, tt.key); err != nil {
				t.Fatal(err)
			}
			if err := fx.f.Handle(context.Background(), fx.id); err != nil {
				t.Fatal(err)
			}
			if len(fx.yt.asked)+len(fx.tm.asked)+len(fx.tp.asked) != 0 {
				t.Errorf("asked YouTube %v, TMDB %v, ThePornDB %v", fx.yt.asked, fx.tm.paths(), fx.tp.addresses())
			}
			// Its source is off: what it found before is kept.
			if got := fx.read(t); got.onlineTitle.String != "trovato prima" {
				t.Errorf("video = %+v", got)
			}
		})
	}
}
