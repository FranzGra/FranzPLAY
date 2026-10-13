package online

import (
	"encoding/json"
	"net/http"
	"net/url"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/users"
)

// aJPEG starts like every JPEG picture.
var aJPEG = []byte("\xff\xd8\xff\xe0 a picture")

func jpegAnswer(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "image/jpeg")
	_, _ = w.Write(aJPEG)
}

type searchAnswer struct {
	Results []candidate `json:"results"`
}

func (fx *adminFixture) search(t *testing.T, source, words string) (int, searchAnswer) {
	t.Helper()
	rec := fx.do("GET", "/api/online/search?"+url.Values{"source": {source}, "q": {words}}.Encode(), "")
	var got searchAnswer
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("search answer %s: %v", rec.Body, err)
		}
	}
	return rec.Code, got
}

func TestSearchTMDBByHand(t *testing.T) {
	fx := newAdminFixture(t)
	turnTMDBOn(t, fx.fixture)
	fx.tm.answers["/3/search/movie?it-IT"] = answer(http.StatusOK, `{"results": [
		{"id": 6, "title": "Il sorpasso", "release_date": "1962-12-05", "backdrop_path": "/wide.jpg"},
		{"id": 7, "title": "Senza foto", "release_date": "", "poster_path": "/../x.jpg"}]}`)
	fx.tm.answers["/t/p/w300/wide.jpg"] = jpegAnswer

	code, got := fx.search(t, "tmdb", "  il sorpasso ")
	if code != http.StatusOK {
		t.Fatalf("search = %d", code)
	}
	want := []candidate{
		{Title: "Il sorpasso", Date: "1962-12-05", Picture: "/w1280/wide.jpg", Thumb: "/w300/wide.jpg"},
		{Title: "Senza foto"},
	}
	if len(got.Results) != len(want) || got.Results[0] != want[0] || got.Results[1] != want[1] {
		t.Fatalf("results = %+v, want %+v", got.Results, want)
	}
	if asked := fx.tm.asked[len(fx.tm.asked)-1].URL.Query().Get("query"); asked != "il sorpasso" {
		t.Errorf("TMDB was asked %q, want the words without spaces around", asked)
	}

	rec := fx.do("GET", "/api/online/picture?source=tmdb&at="+url.QueryEscape("/w300/wide.jpg"), "")
	if rec.Code != http.StatusOK || rec.Body.String() != string(aJPEG) || rec.Header().Get("Content-Type") != "image/jpeg" {
		t.Errorf("picture = %d %q %s", rec.Code, rec.Body, rec.Header().Get("Content-Type"))
	}
}

func TestSearchTPDBByHand(t *testing.T) {
	fx := newAdminFixture(t)
	turnTPDBOn(t, fx.fixture, "scena.mp4")
	fx.tp.answers["cdn.theporndb.net/small.jpg"] = jpegAnswer
	fx.tp.answers["api.theporndb.net/scenes"] = answer(http.StatusOK, `{"data": [{"title": "Una scena",
		"date": "2021-03-15", "site": {"name": "Uno Studio"},
		"background": {"large": "https://cdn.theporndb.net/wide.jpg", "small": "https://cdn.theporndb.net/small.jpg"}}]}`)

	code, got := fx.search(t, "tpdb", "una scena")
	want := candidate{Title: "Una scena", Date: "2021-03-15", Author: "Uno Studio",
		Picture: "https://cdn.theporndb.net/wide.jpg", Thumb: "https://cdn.theporndb.net/small.jpg"}
	if code != http.StatusOK || len(got.Results) != 1 || got.Results[0] != want {
		t.Fatalf("search = %d %+v, want %+v", code, got.Results, want)
	}
	if q := fx.tp.asked[len(fx.tp.asked)-1].URL.Query(); q.Get("q") != "una scena" || q.Get("hash") != "" {
		t.Errorf("ThePornDB was asked %v, want a search by words", q)
	}

	rec := fx.do("GET", "/api/online/picture?source=tpdb&at="+url.QueryEscape("https://cdn.theporndb.net/small.jpg"), "")
	if rec.Code != http.StatusOK || rec.Body.String() != string(aJPEG) {
		t.Errorf("picture = %d %q", rec.Code, rec.Body)
	}
}

func TestSearchByHandRefuses(t *testing.T) {
	fx := newAdminFixture(t)

	// A source turned off is not asked.
	if code, _ := fx.search(t, "tmdb", "il sorpasso"); code != http.StatusConflict {
		t.Errorf("search with TMDB off = %d, want 409", code)
	}
	if rec := fx.do("GET", "/api/online/picture?source=tmdb&at=/w300/wide.jpg", ""); rec.Code != http.StatusConflict {
		t.Errorf("picture with TMDB off = %d, want 409", rec.Code)
	}
	turnTMDBOn(t, fx.fixture)

	for _, tt := range []struct{ source, words string }{
		{"youtube", "gita"},
		{"tmdb", "   "},
		{"tmdb", string(make([]byte, 201))},
	} {
		if code, _ := fx.search(t, tt.source, tt.words); code != http.StatusBadRequest {
			t.Errorf("search %s %q = %d, want 400", tt.source, tt.words, code)
		}
	}

	// Only pictures on the sources' own servers are fetched.
	for _, at := range []string{
		"/w300/../../x.jpg", "/w500/wide.jpg", "https://evil.example/x.jpg", "//evil.example/x.jpg",
	} {
		if rec := fx.do("GET", "/api/online/picture?source=tmdb&at="+url.QueryEscape(at), ""); rec.Code != http.StatusBadRequest {
			t.Errorf("picture at %q = %d, want 400", at, rec.Code)
		}
	}
	if rec := fx.do("GET", "/api/online/picture?source=tpdb&at="+url.QueryEscape("https://evil.example/theporndb.net.jpg"), ""); rec.Code != http.StatusBadRequest {
		t.Errorf("picture elsewhere = %d, want 400", rec.Code)
	}

	// Something that is not a picture is not passed on.
	fx.tm.answers["/t/p/w300/page.jpg"] = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte("<html><script>"))
	}
	if rec := fx.do("GET", "/api/online/picture?source=tmdb&at=/w300/page.jpg", ""); rec.Code != http.StatusBadGateway {
		t.Errorf("not a picture = %d, want 502", rec.Code)
	}
	if rec := fx.do("GET", "/api/online/picture?source=tmdb&at=/w300/gone.jpg", ""); rec.Code != http.StatusNotFound {
		t.Errorf("picture gone = %d, want 404", rec.Code)
	}

	fx.tm.answers["/3/search/movie?it-IT"] = answer(http.StatusUnauthorized, `{}`)
	if code, _ := fx.search(t, "tmdb", "il sorpasso"); code != http.StatusUnprocessableEntity {
		t.Errorf("search with a refused key = %d, want 422", code)
	}
	fx.tm.answers["/3/search/movie?it-IT"] = answer(http.StatusServiceUnavailable, `{}`)
	if code, _ := fx.search(t, "tmdb", "il sorpasso"); code != http.StatusBadGateway {
		t.Errorf("search while TMDB is down = %d, want 502", code)
	}

	fx.who.Role = users.User
	if code, _ := fx.search(t, "tmdb", "il sorpasso"); code != http.StatusForbidden {
		t.Errorf("search by someone not an administrator = %d, want 403", code)
	}
}
