package autosubs

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// fakeLanguages is a translator that knows some languages, or does not answer.
type fakeLanguages struct {
	known []string
	err   error
}

func (f fakeLanguages) Languages(context.Context) ([]string, error) { return f.known, f.err }

type site struct {
	db      *sql.DB
	dataDir string
	library string
	opts    Options
	who     users.Account
	queued  int
}

func newSite(t *testing.T) *site {
	t.Helper()
	dataDir := t.TempDir()
	db, err := database.Open(context.Background(), dataDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	s := &site{db: db, dataDir: dataDir, library: t.TempDir(), who: users.Account{ID: 1, Name: "Admin", Role: users.Admin}}
	s.opts = Options{DataDir: dataDir, Whisper: true, Translator: fakeLanguages{known: []string{"en", "it"}}}
	s.exec(t, `INSERT INTO libraries (id, path) VALUES (1, ?)`, s.library)
	if err := os.MkdirAll(filepath.Join(dataDir, media.WhisperDir), 0o750); err != nil {
		t.Fatal(err)
	}
	for _, m := range []string{"small", "medium"} {
		if err := os.WriteFile(media.ModelFile(dataDir, m), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return s
}

func (s *site) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := s.db.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

// addVideo adds a video in the library, with its file.
func (s *site) addVideo(t *testing.T, rel, title string) int64 {
	t.Helper()
	name := filepath.Join(s.library, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(name), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	res, err := s.db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, added_at)
		VALUES (?, 1, ?, 1, 1, ?, 1)`, "fp-"+rel, rel, title)
	if err != nil {
		t.Fatal(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func (s *site) do(t *testing.T, method, target, body string, want int) *httptest.ResponseRecorder {
	t.Helper()
	p := page{db: s.db, opts: s.opts, queued: func() { s.queued++ },
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		now:    func() time.Time { return time.Unix(1_800_000_000, 0) },
		account: func(context.Context) (users.Account, bool) {
			return s.who, s.who.ID != 0
		}}
	mux := http.NewServeMux()
	p.routes(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(method, target, bytes.NewBufferString(body)))
	if rec.Code != want {
		t.Fatalf("%s %s = %d, want %d; body %s", method, target, rec.Code, want, rec.Body)
	}
	return rec
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %s: %v", rec.Body, err)
	}
	return v
}

func TestSetup(t *testing.T) {
	s := newSite(t)
	got := decode[Setup](t, s.do(t, "GET", "/api/admin/subtitles/setup", "", http.StatusOK))
	if !got.Whisper || !reflect.DeepEqual(got.Models, []string{"medium", "small"}) || !got.Translator ||
		got.TranslatorError != "" || !reflect.DeepEqual(got.TranslatorLanguages, []string{"en", "it"}) ||
		len(got.Languages) != 6 || !filepath.IsAbs(got.ModelsFolder) {
		t.Errorf("setup = %+v", got)
	}

	s.opts.Translator = fakeLanguages{err: errors.New("connection refused")}
	got = decode[Setup](t, s.do(t, "GET", "/api/admin/subtitles/setup", "", http.StatusOK))
	if got.TranslatorError == "" || len(got.TranslatorLanguages) != 0 {
		t.Errorf("translator down: %+v", got)
	}

	s.opts = Options{DataDir: t.TempDir()}
	got = decode[Setup](t, s.do(t, "GET", "/api/admin/subtitles/setup", "", http.StatusOK))
	if got.Whisper || got.Translator || got.Models == nil || len(got.Models) != 0 {
		t.Errorf("nothing installed: %+v", got)
	}
}

func TestOnlyAdministrators(t *testing.T) {
	s := newSite(t)
	s.who = users.Account{ID: 2, Name: "Ada", Role: users.User}
	s.do(t, "GET", "/api/admin/subtitles", "", http.StatusForbidden)
	s.do(t, "PUT", "/api/admin/subtitles/1", `{"model":"small"}`, http.StatusForbidden)
	s.who = users.Account{}
	s.do(t, "GET", "/api/admin/subtitles/setup", "", http.StatusUnauthorized)
}

func TestAskAndTakeBack(t *testing.T) {
	s := newSite(t)
	id := s.addVideo(t, "Viaggi/mare.mp4", "Mare")
	path := "/api/admin/subtitles/" + strconv.FormatInt(id, 10)

	s.do(t, "PUT", path, `{"spoken":"it","model":"small","translate":["en","de"]}`, http.StatusNoContent)
	if s.queued != 1 {
		t.Errorf("queued %d times, want 1", s.queued)
	}
	var spoken, model, langs, state string
	if err := s.db.QueryRow(`SELECT r.spoken, r.model, r.langs, j.state FROM subtitle_requests r
		JOIN jobs j ON j.video_id = r.video_id AND j.kind = 'transcribe' WHERE r.video_id = ?`, id).
		Scan(&spoken, &model, &langs, &state); err != nil {
		t.Fatal(err)
	}
	if spoken != "it" || model != "small" || langs != "en,de" || state != "pending" {
		t.Errorf("saved %q %q %q %q", spoken, model, langs, state)
	}

	got := decode[listAnswer](t, s.do(t, "GET", "/api/admin/subtitles", "", http.StatusOK))
	want := &Request{Spoken: "it", Model: "small", Translate: []string{"en", "de"}, State: "pending",
		At: time.Unix(1_800_000_000, 0).UTC()}
	if got.Total != 1 || !reflect.DeepEqual(got.Videos[0].Request, want) {
		t.Errorf("list = %+v", got)
	}

	// Asking again replaces the request.
	s.do(t, "PUT", path, `{"spoken":"","model":"medium","translate":[]}`, http.StatusNoContent)
	got = decode[listAnswer](t, s.do(t, "GET", "/api/admin/subtitles", "", http.StatusOK))
	if r := got.Videos[0].Request; r.Spoken != "" || r.Model != "medium" || len(r.Translate) != 0 {
		t.Errorf("request = %+v", r)
	}

	s.do(t, "DELETE", path+"/request", "", http.StatusNoContent)
	var jobsLeft int
	if err := s.db.QueryRow(`SELECT count(*) FROM jobs WHERE kind = 'transcribe'`).Scan(&jobsLeft); err != nil {
		t.Fatal(err)
	}
	if jobsLeft != 0 {
		t.Errorf("%d jobs left", jobsLeft)
	}
	got = decode[listAnswer](t, s.do(t, "GET", "/api/admin/subtitles", "", http.StatusOK))
	if got.Videos[0].Request != nil {
		t.Errorf("request still there: %+v", got.Videos[0].Request)
	}
	s.do(t, "DELETE", path+"/request", "", http.StatusNotFound)
}

func TestAskRefuses(t *testing.T) {
	s := newSite(t)
	id := s.addVideo(t, "mare.mp4", "Mare")
	gone := s.addVideo(t, "perso.mp4", "Perso")
	s.exec(t, `UPDATE videos SET missing_since = 1 WHERE id = ?`, gone)
	path := "/api/admin/subtitles/" + strconv.FormatInt(id, 10)
	for name, body := range map[string]string{
		"not json":          `oops`,
		"unknown field":     `{"model":"small","colour":"red"}`,
		"unknown model":     `{"model":"large"}`,
		"model as path":     `{"model":"../small"}`,
		"odd spoken":        `{"model":"small","spoken":"klingon"}`,
		"odd language":      `{"model":"small","translate":["xx"]}`,
		"language twice":    `{"model":"small","translate":["en","en"]}`,
		"language as other": `{"model":"small","translate":["auto"]}`,
	} {
		t.Run(name, func(t *testing.T) {
			s.do(t, "PUT", path, body, http.StatusBadRequest)
		})
	}
	s.do(t, "PUT", "/api/admin/subtitles/999", `{"model":"small"}`, http.StatusNotFound)
	s.do(t, "PUT", "/api/admin/subtitles/"+strconv.FormatInt(gone, 10), `{"model":"small"}`, http.StatusConflict)

	s.opts.Translator = nil
	s.do(t, "PUT", path, `{"model":"small","translate":["en"]}`, http.StatusBadRequest)
	s.do(t, "PUT", path, `{"model":"small"}`, http.StatusNoContent)
	s.opts.Whisper = false
	s.do(t, "PUT", path, `{"model":"small"}`, http.StatusBadRequest)
	if s.queued != 1 {
		t.Errorf("queued %d times, want 1", s.queued)
	}
}

func TestListShowsEverySubtitle(t *testing.T) {
	s := newSite(t)
	mare := s.addVideo(t, "Viaggi/mare.mp4", "Mare")
	lago := s.addVideo(t, "Viaggi/lago.mkv", "Lago")
	bosco := s.addVideo(t, "bosco.mp4", "Bosco")
	for _, name := range []string{"Viaggi/mare.it.srt", "Viaggi/mare.srt"} {
		if err := os.WriteFile(filepath.Join(s.library, filepath.FromSlash(name)), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	s.exec(t, `INSERT INTO video_subtitles (video_id, stream, lang, title, forced, file) VALUES (?, 2, 'eng', '', 0, 'x.vtt')`, lago)
	s.exec(t, `INSERT INTO auto_subtitles (video_id, lang, translated_from, model, fingerprint, file, made_at) VALUES
		(?, 'it', '', 'small', 'fp-Viaggi/lago.mkv', 'a.vtt', 1), (?, 'de', 'it', 'small', 'fp-Viaggi/lago.mkv', 'b.vtt', 1),
		(?, 'fr', '', 'small', 'old content', 'c.vtt', 1)`, lago, lago, bosco)
	s.exec(t, `INSERT INTO subtitle_requests (video_id, spoken, model, langs, stage, requested_at) VALUES (?, '', 'small', 'en', 'transcribe', 5)`, bosco)
	s.exec(t, `INSERT INTO jobs (video_id, kind, state, last_error, updated_at) VALUES (?, 'transcribe', 'failed', 'whisper: exit status 1', 5)`, bosco)

	got := decode[listAnswer](t, s.do(t, "GET", "/api/admin/subtitles", "", http.StatusOK))
	if got.Total != 3 {
		t.Fatalf("total %d", got.Total)
	}
	// The one with a request first, then by title.
	if got.Videos[0].ID != bosco || got.Videos[1].ID != lago || got.Videos[2].ID != mare {
		t.Errorf("order %+v", got.Videos)
	}
	if r := got.Videos[0].Request; r == nil || r.State != "failed" || r.Error != "whisper: exit status 1" || r.Stage != "transcribe" {
		t.Errorf("request %+v", r)
	}
	if subs := got.Videos[0].Subtitles; len(subs) != 0 {
		t.Errorf("bosco: %+v, the old content's subtitles do not count", subs)
	}
	wantLago := []Subtitle{{Lang: "en", Source: FromInside}, {Lang: "it", Source: FromAuto}, {Lang: "de", Source: FromAuto, From: "it"}}
	if !reflect.DeepEqual(got.Videos[1].Subtitles, wantLago) {
		t.Errorf("lago: %+v", got.Videos[1].Subtitles)
	}
	wantMare := []Subtitle{{Lang: "it", Source: FromFile}, {Lang: "", Source: FromFile}}
	if !reflect.DeepEqual(got.Videos[2].Subtitles, wantMare) {
		t.Errorf("mare: %+v", got.Videos[2].Subtitles)
	}

	for query, want := range map[string][]int64{
		"have=without":     {bosco},
		"have=with":        {lago, mare},
		"lang=it":          {lago, mare},
		"lang=de":          {lago},
		"have=with&q=mar":  {mare},
		"limit=1&offset=1": {lago},
	} {
		got := decode[listAnswer](t, s.do(t, "GET", "/api/admin/subtitles?"+query, "", http.StatusOK))
		var ids []int64
		for _, v := range got.Videos {
			ids = append(ids, v.ID)
		}
		if !reflect.DeepEqual(ids, want) {
			t.Errorf("%s: %v, want %v", query, ids, want)
		}
	}
	for _, query := range []string{"have=maybe", "lang=italiano", "limit=0", "limit=500", "offset=-1"} {
		s.do(t, "GET", "/api/admin/subtitles?"+query, "", http.StatusBadRequest)
	}
}

func TestDeleteMade(t *testing.T) {
	s := newSite(t)
	id := s.addVideo(t, "mare.mp4", "Mare")
	dir := filepath.Join(s.dataDir, media.AutoSubtitlesDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "1-en.vtt"), []byte("WEBVTT\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	s.exec(t, `INSERT INTO auto_subtitles (video_id, lang, translated_from, model, fingerprint, file, made_at)
		VALUES (?, 'en', 'it', 'small', 'fp-mare.mp4', '1-en.vtt', 1)`, id)
	path := "/api/admin/subtitles/" + strconv.FormatInt(id, 10) + "/made/"
	s.do(t, "DELETE", path+"en", "", http.StatusNoContent)
	if _, err := os.Stat(filepath.Join(dir, "1-en.vtt")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("file still there: %v", err)
	}
	s.do(t, "DELETE", path+"en", "", http.StatusNotFound)
	s.do(t, "DELETE", path+"EN", "", http.StatusNotFound)
	s.do(t, "DELETE", path+"english", "", http.StatusNotFound)
}
