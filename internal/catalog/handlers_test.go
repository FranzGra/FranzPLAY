package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strconv"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/server"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// site is the whole HTTP handler on a catalog prepared by the test.
type site struct {
	handler http.Handler
	db      *sql.DB
	library string
	dataDir string
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
	s := &site{db: db, library: t.TempDir(), dataDir: dataDir}
	if _, err := db.Exec(`INSERT INTO libraries (id, path) VALUES (1, ?)`, s.library); err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	ui := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "ui") })
	s.handler = server.New("test", logger, ui, Routes(db, dataDir, logger))
	return s
}

// addVideo puts a file in the library and its row in the catalog.
func (s *site) addVideo(t *testing.T, rel, content, category string, addedAt int64, probed bool) int64 {
	t.Helper()
	name := filepath.Join(s.library, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(name), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	res, err := s.db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, category, added_at)
		VALUES (?, 1, ?, ?, 1, ?, ?, ?)`, "fp-"+rel, rel, len(content), filepath.Base(rel), category, addedAt)
	if err != nil {
		t.Fatal(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if probed {
		if _, err := s.db.Exec(`UPDATE videos SET duration = 90, width = 1280, height = 720,
			video_codec = 'h264', audio_codec = 'aac', container = 'mov,mp4', cover = ? WHERE id = ?`,
			"1-abc.jpg", id); err != nil {
			t.Fatal(err)
		}
	}
	return id
}

func (s *site) get(t *testing.T, target string, header ...string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	for i := 0; i+1 < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	rec := httptest.NewRecorder()
	s.handler.ServeHTTP(rec, req)
	return rec
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.NewDecoder(rec.Body).Decode(&v); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return v
}

func TestListVideos(t *testing.T) {
	s := newSite(t)
	older := s.addVideo(t, "Viaggi/mare.mp4", "sea", "Viaggi", 100, true)
	newer := s.addVideo(t, "prova.mkv", "test", "", 200, false)
	gone := s.addVideo(t, "Viaggi/vecchio.mp4", "old", "Viaggi", 300, false)
	if _, err := s.db.Exec(`UPDATE videos SET missing_since = 1 WHERE id = ?`, gone); err != nil {
		t.Fatal(err)
	}

	rec := s.get(t, "/api/videos")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	got := decode[listResponse](t, rec)
	if got.Total != 2 || len(got.Videos) != 2 || got.Videos[0].ID != newer || got.Videos[1].ID != older {
		t.Fatalf("list = %+v, want the two present videos, newest first", got)
	}

	sea := got.Videos[1]
	if sea.Title != "mare.mp4" || sea.Category != "Viaggi" || *sea.Duration != 90 ||
		*sea.Width != 1280 || *sea.Height != 720 || *sea.Cover != "/api/covers/1-abc.jpg" || !sea.Playable {
		t.Errorf("probed video = %+v", sea)
	}
	notRead := got.Videos[0]
	if notRead.Duration != nil || notRead.Width != nil || notRead.Cover != nil || notRead.Playable {
		t.Errorf("video not read yet = %+v, want null details and not playable", notRead)
	}
}

func TestListVideosByCategoryAndPage(t *testing.T) {
	s := newSite(t)
	for i, rel := range []string{"Viaggi/a.mp4", "Viaggi/b.mp4", "Viaggi/c.mp4", "Corsi/d.mp4"} {
		s.addVideo(t, rel, rel, filepath.Dir(rel), int64(i), false)
	}

	got := decode[listResponse](t, s.get(t, "/api/videos?category=Viaggi&limit=2&offset=1"))
	if got.Total != 3 || len(got.Videos) != 2 || got.Videos[0].Title != "b.mp4" || got.Videos[1].Title != "a.mp4" {
		t.Errorf("page = %+v", got)
	}

	empty := s.get(t, "/api/videos?category=Nessuna")
	if body := empty.Body.String(); body != "{\"videos\":[],\"total\":0}\n" {
		t.Errorf("empty list body = %q, want an empty array", body)
	}

	if rec := s.get(t, "/api/videos?limit=1000"); rec.Code != http.StatusBadRequest {
		t.Errorf("limit=1000: status %d, want 400", rec.Code)
	}
}

func TestVideoFormatAndLikes(t *testing.T) {
	s := newSite(t)
	mare := s.addVideo(t, "Viaggi/mare.mp4", "sea", "Viaggi", 100, true)
	s.addVideo(t, "prova.mkv", "test", "", 200, false)
	s.addVideo(t, "senza", "none", "", 300, false)
	for _, q := range []string{
		`INSERT INTO users (id, name, password_hash, role, created_at) VALUES (1, 'Giulia', 'x', 'admin', 1), (2, 'Marco', 'x', 'user', 1)`,
		fmt.Sprintf(`INSERT INTO likes (user_id, video_id, created_at) VALUES (1, %d, 1), (2, %d, 1)`, mare, mare),
	} {
		if _, err := s.db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	got := decode[listResponse](t, s.get(t, "/api/videos"))
	want := map[string]struct {
		format string
		likes  int64
	}{"mare.mp4": {"MP4", 2}, "prova.mkv": {"MKV", 0}, "senza": {"", 0}}
	for _, v := range got.Videos {
		if w := want[v.Title]; v.Format != w.format || v.Likes != w.likes {
			t.Errorf("%s: format %q, likes %d; want %q, %d", v.Title, v.Format, v.Likes, w.format, w.likes)
		}
	}
	if one := decode[Video](t, s.get(t, "/api/videos/"+strconv.FormatInt(mare, 10))); one.Likes != 2 || one.Format != "MP4" {
		t.Errorf("one video: %+v", one)
	}
}

func TestListVideosMixed(t *testing.T) {
	s := newSite(t)
	for i := range 30 {
		cat := "Viaggi"
		if i%3 == 0 {
			cat = "Corsi"
		}
		s.addVideo(t, fmt.Sprintf("%s/%02d.mp4", cat, i), fmt.Sprint(i), cat, int64(i), false)
	}
	page := func(target string) listResponse {
		t.Helper()
		rec := s.get(t, target)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", target, rec.Code, rec.Body)
		}
		return decode[listResponse](t, rec)
	}

	// Three pages of one visit: every video once, not newest first.
	var seen []int64
	for offset := 0; offset < 30; offset += 12 {
		got := page(fmt.Sprintf("/api/videos?order=random&seed=5&limit=12&offset=%d", offset))
		if got.Total != 30 {
			t.Errorf("total = %d, want 30", got.Total)
		}
		for _, v := range got.Videos {
			seen = append(seen, v.ID)
		}
	}
	if len(seen) != 30 || len(slices.Compact(slices.Sorted(slices.Values(seen)))) != 30 {
		t.Errorf("pages gave %v, want the 30 videos once each", seen)
	}
	newest := page("/api/videos?limit=30")
	if newest.Videos[0].ID == seen[0] && newest.Videos[1].ID == seen[1] && newest.Videos[2].ID == seen[2] {
		t.Errorf("mixed order starts like the newest: %v", seen[:3])
	}
	if again := page("/api/videos?order=random&seed=5&limit=12"); again.Videos[0].ID != seen[0] {
		t.Error("the same seed gave another order")
	}

	// The category still filters, and a page past the end is empty.
	got := page("/api/videos?order=random&seed=5&category=Corsi&limit=200")
	if got.Total != 10 || len(got.Videos) != 10 {
		t.Errorf("Corsi mixed: total %d, %d videos, want 10", got.Total, len(got.Videos))
	}
	for _, v := range got.Videos {
		if v.Category != "Corsi" {
			t.Errorf("video %q of %q in Corsi", v.Title, v.Category)
		}
	}
	if past := page("/api/videos?order=random&seed=5&offset=100"); past.Total != 30 || len(past.Videos) != 0 {
		t.Errorf("past the end: %+v", past)
	}
}

func TestSearchVideos(t *testing.T) {
	s := newSite(t)
	s.addVideo(t, "Vacanze/Mare a Rimini.mp4", "1", "Vacanze", 1, false)
	s.addVideo(t, "Vacanze/Montagna.mp4", "2", "Vacanze", 2, false)
	s.addVideo(t, "Scuola/Recita al mare.mp4", "3", "Scuola", 3, false)
	s.addVideo(t, "Sconto 50% al mare.mp4", "4", "", 4, false)
	s.addVideo(t, "Sconto 500 euro.mp4", "5", "", 5, false)

	titles := func(query string) []string {
		t.Helper()
		got := decode[listResponse](t, s.get(t, "/api/videos?"+query))
		out := []string{}
		for _, v := range got.Videos {
			out = append(out, v.Title)
		}
		if got.Total != len(out) {
			t.Errorf("%s: total %d for %d videos", query, got.Total, len(out))
		}
		return out
	}
	for query, want := range map[string][]string{
		"q=MARE":                 {"Sconto 50% al mare.mp4", "Recita al mare.mp4", "Mare a Rimini.mp4"},
		"q=mare+rimini":          {"Mare a Rimini.mp4"},
		"q=vacanze":              {"Montagna.mp4", "Mare a Rimini.mp4"}, // the category counts too
		"q=mare&category=Scuola": {"Recita al mare.mp4"},
		"q=50%25":                {"Sconto 50% al mare.mp4"}, // % is a letter, not "anything"
		"q=nessuno":              {},
	} {
		if got := titles(query); !reflect.DeepEqual(got, want) {
			t.Errorf("%s: got %q, want %q", query, got, want)
		}
	}
}

func TestGetVideo(t *testing.T) {
	s := newSite(t)
	id := s.addVideo(t, "mare.mp4", "sea", "", 1, true)

	rec := s.get(t, "/api/videos/1")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if v := decode[Video](t, rec); v.ID != id || v.Title != "mare.mp4" {
		t.Errorf("video = %+v", v)
	}
	for _, target := range []string{"/api/videos/999", "/api/videos/abc", "/api/videos/0"} {
		if rec := s.get(t, target); rec.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", target, rec.Code)
		}
	}
}

func TestVideoDetailsFromAFileNextToIt(t *testing.T) {
	s := newSite(t)
	id := s.addVideo(t, "gita [abc].mp4", "trip", "", 1, true)
	s.addVideo(t, "altro.mp4", "other", "", 2, true)
	if _, err := s.db.Exec(`UPDATE videos SET details_title = 'Gita in montagna', description = 'Che giornata!',
		author = 'Famiglia Rossi', published_on = '2019-03-15' WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}

	v := decode[Video](t, s.get(t, "/api/videos/1"))
	if v.Title != "Gita in montagna" || v.Author != "Famiglia Rossi" ||
		v.PublishedOn == nil || *v.PublishedOn != "2019-03-15" ||
		v.Description == nil || *v.Description != "Che giornata!" {
		t.Errorf("video = %+v", v)
	}

	// The list has the title, and is searched by it, but not the description.
	list := decode[listResponse](t, s.get(t, "/api/videos?q=montagna"))
	if len(list.Videos) != 1 || list.Videos[0].Title != "Gita in montagna" || list.Videos[0].Description != nil {
		t.Errorf("search = %+v", list.Videos)
	}
	other := decode[Video](t, s.get(t, "/api/videos/2"))
	if other.Title != "altro.mp4" || other.Author != "" || other.PublishedOn != nil || other.Description != nil {
		t.Errorf("video without details = %+v", other)
	}
}

func TestCategories(t *testing.T) {
	s := newSite(t)
	s.addVideo(t, "viaggi/a.mp4", "a", "viaggi", 1, false)
	s.addVideo(t, "Corsi/b.mp4", "b", "Corsi", 1, false)
	s.addVideo(t, "Corsi/c.mp4", "c", "Corsi", 1, false)
	s.addVideo(t, "d.mp4", "d", "", 1, false)

	got := decode[[]Category](t, s.get(t, "/api/categories"))
	want := []Category{{"Corsi", 2}, {"viaggi", 1}}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("categories = %+v, want %+v", got, want)
	}
}

func TestStreamSupportsJumping(t *testing.T) {
	s := newSite(t)
	s.addVideo(t, "Viaggi/mare.mp4", "0123456789", "Viaggi", 1, true)

	full := s.get(t, "/api/videos/1/stream")
	if full.Code != http.StatusOK || full.Body.String() != "0123456789" {
		t.Fatalf("full file: %d %q", full.Code, full.Body)
	}
	if ct := full.Header().Get("Content-Type"); ct != "video/mp4" {
		t.Errorf("Content-Type = %q", ct)
	}
	if ar := full.Header().Get("Accept-Ranges"); ar != "bytes" {
		t.Errorf("Accept-Ranges = %q, want bytes", ar)
	}

	// The player jumps ahead: it asks only for bytes 3 to 6.
	part := s.get(t, "/api/videos/1/stream", "Range", "bytes=3-6")
	if part.Code != http.StatusPartialContent || part.Body.String() != "3456" {
		t.Errorf("range: %d %q, want 206 \"3456\"", part.Code, part.Body)
	}
	if cr := part.Header().Get("Content-Range"); cr != "bytes 3-6/10" {
		t.Errorf("Content-Range = %q", cr)
	}
}

func TestStreamSendsTheCopyForTheBrowsers(t *testing.T) {
	s := newSite(t)
	id := s.addVideo(t, "film.mkv", "matroska", "", 1, true)
	if _, err := s.db.Exec(`UPDATE videos SET video_codec = 'hevc' WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	if v := decode[Video](t, s.get(t, "/api/videos/1")); v.Playable {
		t.Error("HEVC in Matroska said playable before its copy is ready")
	}
	if rec := s.get(t, "/api/videos/1/stream"); rec.Body.String() != "matroska" {
		t.Errorf("before the copy: %q, want the file itself", rec.Body)
	}

	// The copy is ready.
	dir := filepath.Join(s.dataDir, "converted")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "1-abc.mp4"), []byte("mp4 copy"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE videos SET converted = '1-abc.mp4' WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	if v := decode[Video](t, s.get(t, "/api/videos/1")); !v.Playable {
		t.Error("video with a copy said not playable")
	}
	rec := s.get(t, "/api/videos/1/stream")
	if rec.Body.String() != "mp4 copy" || rec.Header().Get("Content-Type") != "video/mp4" {
		t.Errorf("with the copy: %q %q", rec.Body, rec.Header().Get("Content-Type"))
	}
}

func TestStreamOfMissingVideos(t *testing.T) {
	s := newSite(t)
	s.addVideo(t, "a.mp4", "a", "", 1, false)
	gone := s.addVideo(t, "b.mp4", "b", "", 1, false)
	if _, err := s.db.Exec(`UPDATE videos SET missing_since = 1 WHERE id = ?`, gone); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(s.library, "a.mp4")); err != nil {
		t.Fatal(err)
	}

	for _, target := range []string{"/api/videos/1/stream", "/api/videos/2/stream", "/api/videos/9/stream"} {
		if rec := s.get(t, target); rec.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", target, rec.Code)
		}
	}
}

func TestCover(t *testing.T) {
	s := newSite(t)
	dir := filepath.Join(s.dataDir, media.CoversDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "1-abc.jpg"), []byte("jpeg"), 0o600); err != nil {
		t.Fatal(err)
	}

	rec := s.get(t, "/api/covers/1-abc.jpg")
	if rec.Code != http.StatusOK || rec.Body.String() != "jpeg" {
		t.Fatalf("cover: %d %q", rec.Code, rec.Body)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q", cc)
	}

	for _, target := range []string{
		"/api/covers/2-abc.jpg",            // no such file
		"/api/covers/..%2Ffranzplay.db",    // trying to leave the folder
		"/api/covers/" + database.FileName, // not a cover name
	} {
		if rec := s.get(t, target); rec.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", target, rec.Code)
		}
	}
}

func TestSubtitles(t *testing.T) {
	s := newSite(t)
	id := s.addVideo(t, "Viaggi/mare.mp4", "sea", "Viaggi", 1, true)
	write := func(name, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(s.library, "Viaggi", name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("mare.it.srt", "1\r\n00:00:01,000 --> 00:00:02,000\r\nPerch\xe9 s\xec\r\n")
	write("mare.en.vtt", "WEBVTT\n\n00:01.000 --> 00:02.000\nWhy yes\n")
	write("monte.it.srt", "not mine")
	write("mare.txt", "not a subtitle")

	rec := s.get(t, "/api/videos/"+strconv.FormatInt(id, 10)+"/subtitles")
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	tracks := decode[[]subtitleTrack](t, rec)
	want := []subtitleTrack{
		{Key: "en.vtt", Lang: "en", Label: "Inglese", Src: "/api/videos/1/subtitles/en.vtt"},
		{Key: "it.srt", Lang: "it", Label: "Italiano", Src: "/api/videos/1/subtitles/it.srt"},
	}
	if !reflect.DeepEqual(tracks, want) {
		t.Fatalf("tracks = %+v", tracks)
	}

	rec = s.get(t, tracks[1].Src)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "text/vtt; charset=utf-8" {
		t.Fatalf("subtitle: status %d, type %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	if body := rec.Body.String(); body != "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nPerché sì\n" {
		t.Errorf("converted subtitle = %q", body)
	}

	// Only the subtitles of this video can be read, nothing else on the disk.
	for _, key := range []string{"txt", "..%2F..%2Fsecret.srt", "it.vtt", "monte.it.srt"} {
		if rec := s.get(t, "/api/videos/1/subtitles/"+key); rec.Code != http.StatusNotFound {
			t.Errorf("key %q: status %d, want 404", key, rec.Code)
		}
	}
	// The library stays untouched.
	entries, err := os.ReadDir(filepath.Join(s.library, "Viaggi"))
	if err != nil || len(entries) != 5 {
		t.Errorf("library folder changed: %d files, %v", len(entries), err)
	}
}

func TestSubtitlesInsideTheVideo(t *testing.T) {
	s := newSite(t)
	id := s.addVideo(t, "film.mkv", "film", "", 1, true)
	if err := os.WriteFile(filepath.Join(s.library, "film.it.srt"), []byte("1\n00:00:01,000 --> 00:00:02,000\nCiao\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(s.dataDir, media.SubtitlesDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	copied := "WEBVTT\n\n00:01.000 --> 00:02.000\nHello\n"
	if err := os.WriteFile(filepath.Join(dir, "1-abc-3.vtt"), []byte(copied), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`INSERT INTO video_subtitles (video_id, stream, lang, title, forced, file) VALUES
		(?, 3, 'eng', '', 0, '1-abc-3.vtt'), (?, 5, 'ita', '', 1, '1-abc-5.vtt')`, id, id); err != nil {
		t.Fatal(err)
	}

	tracks := decode[[]subtitleTrack](t, s.get(t, "/api/videos/1/subtitles"))
	want := []subtitleTrack{
		{Key: "it.srt", Lang: "it", Label: "Italiano", Src: "/api/videos/1/subtitles/it.srt"},
		{Key: "inside-3", Lang: "en", Label: "Inglese", Src: "/api/videos/1/subtitles/inside-3"},
		{Key: "inside-5", Lang: "it", Label: "Italiano (forzati)", Src: "/api/videos/1/subtitles/inside-5"},
	}
	if !reflect.DeepEqual(tracks, want) {
		t.Fatalf("tracks = %+v", tracks)
	}
	rec := s.get(t, "/api/videos/1/subtitles/inside-3")
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "text/vtt; charset=utf-8" || rec.Body.String() != copied {
		t.Errorf("inside-3: %d %q %q", rec.Code, rec.Header().Get("Content-Type"), rec.Body)
	}
	// A copy gone from the disk, streams that are not there, odd keys.
	for _, key := range []string{"inside-5", "inside-4", "inside-03", "inside--3", "inside-", "inside-x"} {
		if rec := s.get(t, "/api/videos/1/subtitles/"+key); rec.Code != http.StatusNotFound {
			t.Errorf("key %q: status %d, want 404", key, rec.Code)
		}
	}
	// A hidden video keeps its subtitles to itself.
	if _, err := s.db.Exec(`UPDATE videos SET hidden_at = 1 WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	if rec := s.get(t, "/api/videos/1/subtitles/inside-3"); rec.Code != http.StatusNotFound {
		t.Errorf("hidden video: status %d, want 404", rec.Code)
	}
}

func TestSubtitlesMadeByWhisper(t *testing.T) {
	s := newSite(t)
	id := s.addVideo(t, "film.mkv", "film", "", 1, true)
	dir := filepath.Join(s.dataDir, media.AutoSubtitlesDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	heard := "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nCiao\n"
	if err := os.WriteFile(filepath.Join(dir, "1-it.vtt"), []byte(heard), 0o600); err != nil {
		t.Fatal(err)
	}
	var fingerprint string
	if err := s.db.QueryRow(`SELECT fingerprint FROM videos WHERE id = ?`, id).Scan(&fingerprint); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`INSERT INTO auto_subtitles (video_id, lang, translated_from, model, fingerprint, file, made_at) VALUES
		(?, 'it', '', 'small', ?, '1-it.vtt', 1), (?, 'en', 'it', 'small', ?, '1-en.vtt', 1),
		(?, 'de', 'it', 'small', 'old content', '1-de.vtt', 1)`, id, fingerprint, id, fingerprint, id); err != nil {
		t.Fatal(err)
	}

	tracks := decode[[]subtitleTrack](t, s.get(t, "/api/videos/1/subtitles"))
	want := []subtitleTrack{
		{Key: "auto-en", Lang: "en", Label: "Inglese (automatici)", Src: "/api/videos/1/subtitles/auto-en"},
		{Key: "auto-it", Lang: "it", Label: "Italiano (automatici)", Src: "/api/videos/1/subtitles/auto-it"},
	}
	if !reflect.DeepEqual(tracks, want) {
		t.Fatalf("tracks = %+v", tracks)
	}
	rec := s.get(t, "/api/videos/1/subtitles/auto-it")
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "text/vtt; charset=utf-8" || rec.Body.String() != heard {
		t.Errorf("auto-it: %d %q %q", rec.Code, rec.Header().Get("Content-Type"), rec.Body)
	}
	// A file gone, a language not made, one made from older content, odd keys.
	for _, key := range []string{"auto-en", "auto-fr", "auto-de", "auto-", "auto-../1-it.vtt"} {
		if rec := s.get(t, "/api/videos/1/subtitles/"+key); rec.Code != http.StatusNotFound {
			t.Errorf("key %q: status %d, want 404", key, rec.Code)
		}
	}
	if _, err := s.db.Exec(`UPDATE videos SET hidden_at = 1 WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	if rec := s.get(t, "/api/videos/1/subtitles/auto-it"); rec.Code != http.StatusNotFound {
		t.Errorf("hidden video: status %d, want 404", rec.Code)
	}
}

func TestSubtitlesOfAVideoWithout(t *testing.T) {
	s := newSite(t)
	s.addVideo(t, "mare.mp4", "sea", "", 1, true)
	if body := s.get(t, "/api/videos/1/subtitles").Body.String(); body != "[]\n" {
		t.Errorf("body = %q, want an empty list", body)
	}
	if rec := s.get(t, "/api/videos/9/subtitles"); rec.Code != http.StatusNotFound {
		t.Errorf("unknown video: status %d", rec.Code)
	}
}

func TestReadSmallRefusesBigFiles(t *testing.T) {
	name := filepath.Join(t.TempDir(), "big.srt")
	if err := os.WriteFile(name, make([]byte, 11), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readSmall(name, 10); !errors.Is(err, errTooBig) {
		t.Errorf("err = %v, want errTooBig", err)
	}
	if data, err := readSmall(name, 11); err != nil || len(data) != 11 {
		t.Errorf("at the limit: %d bytes, %v", len(data), err)
	}
}

func TestLookupByIDs(t *testing.T) {
	s := newSite(t)
	a := s.addVideo(t, "a.mp4", "a", "", 1, false)
	b := s.addVideo(t, "b.mp4", "b", "", 2, false)
	gone := s.addVideo(t, "c.mp4", "c", "", 3, false)
	if _, err := s.db.Exec(`UPDATE videos SET missing_since = 1 WHERE id = ?`, gone); err != nil {
		t.Fatal(err)
	}
	videos, err := NewLookup(s.db).ByIDs(context.Background(), []int64{b, 999, gone, a})
	if err != nil {
		t.Fatal(err)
	}
	if len(videos) != 2 || videos[0].ID != b || videos[1].ID != a {
		t.Errorf("videos = %+v, want b then a", videos)
	}
	if none, err := NewLookup(s.db).ByIDs(context.Background(), nil); err != nil || none == nil || len(none) != 0 {
		t.Errorf("no ids: %v, %v", none, err)
	}
}

func TestPreviews(t *testing.T) {
	s := newSite(t)
	id := s.addVideo(t, "mare.mp4", "sea", "", 1, true)
	got := decode[Video](t, s.get(t, "/api/videos/"+strconv.FormatInt(id, 10)))
	if got.Preview != nil {
		t.Errorf("preview before it is made: %+v", got.Preview)
	}

	if _, err := s.db.Exec(`UPDATE videos SET preview = '1-abc.jpg', preview_gap = 2, preview_count = 45 WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	got = decode[Video](t, s.get(t, "/api/videos/"+strconv.FormatInt(id, 10)))
	want := Preview{Src: "/api/previews/1-abc.jpg", Gap: 2, Count: 45, Columns: 10, Width: 160, Height: 90}
	if got.Preview == nil || *got.Preview != want {
		t.Errorf("preview = %+v, want %+v", got.Preview, want)
	}

	dir := filepath.Join(s.dataDir, media.PreviewsDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "1-abc.jpg"), []byte("frames"), 0o600); err != nil {
		t.Fatal(err)
	}
	if rec := s.get(t, "/api/previews/1-abc.jpg"); rec.Code != http.StatusOK || rec.Body.String() != "frames" {
		t.Errorf("preview image: %d %q", rec.Code, rec.Body)
	}
	for _, target := range []string{"/api/previews/2-abc.jpg", "/api/previews/..%2Ffranzplay.db"} {
		if rec := s.get(t, target); rec.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", target, rec.Code)
		}
	}
}

func TestClips(t *testing.T) {
	s := newSite(t)
	id := s.addVideo(t, "mare.mp4", "sea", "", 1, true)
	got := decode[Video](t, s.get(t, "/api/videos/"+strconv.FormatInt(id, 10)))
	if got.Clip != nil {
		t.Errorf("clip before it is made: %q", *got.Clip)
	}

	if _, err := s.db.Exec(`UPDATE videos SET clip = '1-abc.mp4' WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	got = decode[Video](t, s.get(t, "/api/videos/"+strconv.FormatInt(id, 10)))
	if got.Clip == nil || *got.Clip != "/api/clips/1-abc.mp4" {
		t.Errorf("clip = %v, want /api/clips/1-abc.mp4", got.Clip)
	}

	dir := filepath.Join(s.dataDir, media.ClipsDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "1-abc.mp4"), []byte("moving"), 0o600); err != nil {
		t.Fatal(err)
	}
	rec := s.get(t, "/api/clips/1-abc.mp4")
	if rec.Code != http.StatusOK || rec.Body.String() != "moving" || rec.Header().Get("Content-Type") != "video/mp4" {
		t.Errorf("clip: %d %q %q", rec.Code, rec.Header().Get("Content-Type"), rec.Body)
	}
	for _, target := range []string{"/api/clips/2-abc.mp4", "/api/clips/1-abc.jpg", "/api/clips/..%2Ffranzplay.db"} {
		if rec := s.get(t, target); rec.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", target, rec.Code)
		}
	}
}

// getAs asks for target as the person with the id who.
func (s *site) getAs(t *testing.T, who int64, target string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req = req.WithContext(users.NewContext(req.Context(), users.Account{ID: who}))
	rec := httptest.NewRecorder()
	s.handler.ServeHTTP(rec, req)
	return rec
}

func TestPrivateVideoOnlyForItsUploader(t *testing.T) {
	s := newSite(t)
	for _, name := range []string{"Giulia", "Marco"} {
		if _, err := s.db.Exec(`INSERT INTO users (name, password_hash, role, created_at) VALUES (?, 'x', 'user', 1)`,
			name); err != nil {
			t.Fatal(err)
		}
	}
	const giulia, marco = 1, 2
	s.addVideo(t, "public.mp4", "pub", "Mare", 1, true)
	private := s.addVideo(t, "private.mp4", "secret", "Mare", 2, true)
	if _, err := s.db.Exec(`UPDATE videos SET uploaded_by = ?, private = 1 WHERE id = ?`, giulia, private); err != nil {
		t.Fatal(err)
	}
	page := "/api/videos/" + strconv.FormatInt(private, 10)

	// In no list, not even Giulia's: only its own page.
	if list := decode[listResponse](t, s.getAs(t, giulia, "/api/videos")); list.Total != 1 {
		t.Errorf("list has %d videos, want only the public one", list.Total)
	}
	if cats := decode[[]Category](t, s.getAs(t, giulia, "/api/categories")); len(cats) != 1 || cats[0].Videos != 1 {
		t.Errorf("categories = %+v", cats)
	}

	rec := s.getAs(t, giulia, page)
	if rec.Code != http.StatusOK {
		t.Fatalf("Giulia opens her private video: status %d", rec.Code)
	}
	if v := decode[Video](t, rec); !v.Private {
		t.Errorf("video = %+v, want private", v)
	}
	if rec := s.getAs(t, giulia, page+"/stream"); rec.Code != http.StatusOK || rec.Body.String() != "secret" {
		t.Errorf("Giulia plays it: status %d, body %q", rec.Code, rec.Body)
	}
	for _, target := range []string{page, page + "/stream", page + "/subtitles"} {
		if rec := s.getAs(t, marco, target); rec.Code != http.StatusNotFound {
			t.Errorf("Marco asks %s: status %d, want 404", target, rec.Code)
		}
		if rec := s.get(t, target); rec.Code != http.StatusNotFound {
			t.Errorf("nobody asks %s: status %d, want 404", target, rec.Code)
		}
	}

	// Hidden by an administrator: not even Giulia opens it.
	if _, err := s.db.Exec(`UPDATE videos SET hidden_at = 1 WHERE id = ?`, private); err != nil {
		t.Fatal(err)
	}
	if rec := s.getAs(t, giulia, page); rec.Code != http.StatusNotFound {
		t.Errorf("hidden: Giulia gets status %d, want 404", rec.Code)
	}
}

func TestVideosSayWhoUploadedThem(t *testing.T) {
	s := newSite(t)
	if _, err := s.db.Exec(`INSERT INTO users (id, name, password_hash, role, created_at) VALUES (3, 'Giulia', 'x', 'user', 1)`); err != nil {
		t.Fatal(err)
	}
	s.addVideo(t, "folder.mp4", "a", "", 1, false)
	mine := s.addVideo(t, "uploaded.mp4", "b", "", 2, false)
	if _, err := s.db.Exec(`UPDATE videos SET uploaded_by = 3 WHERE id = ?`, mine); err != nil {
		t.Fatal(err)
	}

	list := decode[listResponse](t, s.get(t, "/api/videos"))
	if len(list.Videos) != 2 || list.Videos[1].Uploader != nil {
		t.Fatalf("videos = %+v, want the one from the folder without uploader", list.Videos)
	}
	if u := list.Videos[0].Uploader; u == nil || *u != (Person{ID: 3, Name: "Giulia"}) {
		t.Errorf("uploader = %+v, want Giulia", u)
	}
	if only := decode[listResponse](t, s.get(t, "/api/videos?uploader=3")); only.Total != 1 || only.Videos[0].ID != mine {
		t.Errorf("Giulia's videos = %+v", only)
	}

	// When Giulia goes away, her video stays, without a name.
	if _, err := s.db.Exec(`DELETE FROM users WHERE id = 3`); err != nil {
		t.Fatal(err)
	}
	if v := decode[Video](t, s.get(t, "/api/videos/"+strconv.FormatInt(mine, 10))); v.Uploader != nil {
		t.Errorf("uploader after leaving = %+v", v.Uploader)
	}
}
