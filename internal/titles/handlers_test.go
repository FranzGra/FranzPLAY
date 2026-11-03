package titles

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

type fixture struct {
	who      users.Account
	mux      *http.ServeMux
	retitled int
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	db, err := database.Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.Exec(`INSERT INTO libraries (id, path) VALUES (1, '/lib')`); err != nil {
		t.Fatal(err)
	}
	for i, p := range []string{"Film/Il_mio_video_[1080p].mp4", "Serie_TV/Puntata.01.mkv"} {
		if _, err := db.Exec(`INSERT INTO videos (library_id, path, title, folder_category, size, mod_time, added_at, fingerprint)
			VALUES (1, ?, ?, '', 1, 1, ?, ?)`, p, FileTitle(p), i, "f"+p); err != nil {
			t.Fatal(err)
		}
	}
	fx := &fixture{who: users.Account{ID: 1, Name: "Paolo", Role: users.Admin}}
	a := api{db: db, logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		retitle: func(context.Context) (int, error) { fx.retitled++; return 2, nil },
		account: func(context.Context) (users.Account, bool) { return fx.who, true }}
	fx.mux = http.NewServeMux()
	a.routes(fx.mux)
	return fx
}

func (fx *fixture) do(method, target, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	fx.mux.ServeHTTP(rec, httptest.NewRequest(method, target, strings.NewReader(body)))
	return rec
}

const presetsJSON = `{"rules": [
	{"find": "_", "replace": " ", "regex": false, "on": true},
	{"find": "\\[[^\\]]*\\]", "replace": "", "regex": true, "on": true},
	{"find": "\\s{2,}", "replace": " ", "regex": true, "on": true}
], "categories": false}`

func TestPreviewShowsTheTitle(t *testing.T) {
	fx := newFixture(t)
	rec := fx.do("POST", "/api/admin/title-rules/preview",
		`{"settings": `+presetsJSON+`, "names": ["Il_mio_video_[1080p].mp4", "C:\\Video\\Altro_film.mkv"], "folders": ["Serie_TV"]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("preview = %d %s", rec.Code, rec.Body)
	}
	var got previewResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Titles) != 2 || got.Titles[0] != "Il mio video" || got.Titles[1] != "Altro film" {
		t.Errorf("titles = %q", got.Titles)
	}
	if len(got.Folders) != 1 || got.Folders[0] != "Serie_TV" {
		t.Errorf("folders without the option = %q", got.Folders)
	}
	if fx.retitled != 0 {
		t.Error("a preview changed the titles")
	}
}

func TestABadRegexIsAClearError(t *testing.T) {
	fx := newFixture(t)
	rec := fx.do("PUT", "/api/admin/title-rules", `{"rules": [{"find": "(", "replace": "", "regex": true, "on": true}], "categories": false}`)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "Regola 1") {
		t.Fatalf("PUT = %d %s, want 400 naming rule 1", rec.Code, rec.Body)
	}
	if fx.retitled != 0 {
		t.Error("bad rules made the titles again")
	}
}

func TestSavingRulesMakesTheTitlesAgain(t *testing.T) {
	fx := newFixture(t)
	rec := fx.do("PUT", "/api/admin/title-rules", presetsJSON)
	if rec.Code != http.StatusOK || fx.retitled != 1 {
		t.Fatalf("PUT = %d %s, retitled %d", rec.Code, rec.Body, fx.retitled)
	}
	rec = fx.do("GET", "/api/admin/title-rules", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET = %d %s", rec.Code, rec.Body)
	}
	var got page
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Settings.Rules) != 3 || len(got.Presets) != len(Presets) || len(got.Examples) != 2 {
		t.Fatalf("page = %+v", got)
	}
	if got.Examples[0].File != "Puntata.01.mkv" || got.Examples[0].Folder != "Serie_TV" {
		t.Errorf("newest example = %+v", got.Examples[0])
	}
}

func TestOnlyAdministratorsSeeTheRules(t *testing.T) {
	fx := newFixture(t)
	fx.who.Role = users.User
	for _, c := range [][2]string{{"GET", "/api/admin/title-rules"}, {"PUT", "/api/admin/title-rules"}, {"POST", "/api/admin/title-rules/preview"}} {
		if rec := fx.do(c[0], c[1], presetsJSON); rec.Code != http.StatusForbidden {
			t.Errorf("%s %s = %d, want 403", c[0], c[1], rec.Code)
		}
	}
}
