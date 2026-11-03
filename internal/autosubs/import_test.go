package autosubs

import (
	"net/http"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

const srt = "1\r\n00:00:01,000 --> 00:00:02,500\r\nCiao <b>a tutti</b>\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nSeconda <script>battuta</script>\r\n"

func TestImportedVTT(t *testing.T) {
	got, err := importedVTT([]byte(srt))
	if err != nil {
		t.Fatal(err)
	}
	want := "WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nCiao <b>a tutti</b>\n\n00:00:03.000 --> 00:00:04.000\nSeconda &lt;script&gt;battuta&lt;/script&gt;\n"
	if got != want {
		t.Errorf("from .srt:\n%q\nwant\n%q", got, want)
	}
	vtt := string(rune(0xFEFF)) + "WEBVTT\n\n00:01.000 --> 00:02.000 align:start\nUna\n"
	if got, err := importedVTT([]byte(vtt)); err != nil || got != "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nUna\n" {
		t.Errorf("from .vtt: %q, %v", got, err)
	}
	// Windows-1252, as old Italian files are.
	if got, err := importedVTT([]byte("1\n00:00:01,000 --> 00:00:02,000\nCos\xec \xe8\n")); err != nil || !strings.Contains(got, "Così è") {
		t.Errorf("Windows-1252: %q, %v", got, err)
	}
	for name, data := range map[string]string{
		"binary":       "\x00\x01\x02PK\x03\x04",
		"plain text":   "just some words",
		"ass":          "[Script Info]\nTitle: x\n",
		"no cues":      "WEBVTT\n\nNOTE nothing here\n",
		"control char": "1\n00:00:01,000 --> 00:00:02,000\nA\x07B\n",
	} {
		if _, err := importedVTT([]byte(data)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestImportSubtitles(t *testing.T) {
	s := newSite(t)
	id := s.addVideo(t, "Film/mare.mp4", "Mare")
	path := "/api/admin/subtitles/" + strconv.FormatInt(id, 10) + "/import/"
	s.do(t, "PUT", path+"it", srt, http.StatusNoContent)

	var file, model, fp, from string
	if err := s.db.QueryRow(`SELECT file, model, fingerprint, translated_from FROM auto_subtitles WHERE video_id = ? AND lang = 'it'`, id).
		Scan(&file, &model, &fp, &from); err != nil {
		t.Fatal(err)
	}
	if model != ImportedModel || fp != "fp-Film/mare.mp4" || from != "" {
		t.Errorf("row: model %q fingerprint %q from %q", model, fp, from)
	}
	root := content.Root(s.dataDir)
	if !strings.HasSuffix(file, content.AutoSubtitleFile("it")) {
		t.Errorf("file %q is not where whisper's go (%s)", file, content.AutoSubtitleFile("it"))
	}
	data, err := os.ReadFile(root.File(file, root.AutoSubtitles()))
	if err != nil || !strings.HasPrefix(string(data), "WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nCiao") {
		t.Fatalf("saved file: %q, %v", data, err)
	}
	if s.queued != 1 {
		t.Errorf("pages told %d times, want 1", s.queued)
	}
	// The page lists them as the video's subtitles.
	if body := s.do(t, "GET", "/api/admin/subtitles", "", http.StatusOK).Body.String(); !strings.Contains(body, `"model":"import"`) {
		t.Errorf("list does not show them: %s", body)
	}

	// Already there: only replaced when asked.
	other := "WEBVTT\n\n00:00:05.000 --> 00:00:06.000\nAltra\n"
	s.do(t, "PUT", path+"it", other, http.StatusConflict)
	s.do(t, "PUT", path+"it?replace=1", other, http.StatusNoContent)
	data, err = os.ReadFile(root.File(file, root.AutoSubtitles()))
	if err != nil || !strings.Contains(string(data), "Altra") {
		t.Fatalf("after replacing: %q, %v", data, err)
	}
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM auto_subtitles WHERE video_id = ?`, id).Scan(&n); err != nil || n != 1 {
		t.Errorf("rows = %d, %v", n, err)
	}
}

func TestImportRefusals(t *testing.T) {
	s := newSite(t)
	id := s.addVideo(t, "mare.mp4", "Mare")
	path := "/api/admin/subtitles/" + strconv.FormatInt(id, 10) + "/import/"
	s.do(t, "PUT", path+"i.t", srt, http.StatusBadRequest)
	s.do(t, "PUT", path+"%2e%2e%2fx", srt, http.StatusBadRequest)
	s.do(t, "PUT", path+"i.t", srt, http.StatusBadRequest)
	s.do(t, "PUT", path+"%2e%2e%2fx", srt, http.StatusBadRequest)
	s.do(t, "PUT", path+"italiano", srt, http.StatusBadRequest)
	s.do(t, "PUT", "/api/admin/subtitles/999/import/it", srt, http.StatusNotFound)
	s.do(t, "PUT", path+"it", "not subtitles", http.StatusUnsupportedMediaType)
	s.do(t, "PUT", path+"it", strings.Repeat("a", maxImport+1), http.StatusRequestEntityTooLarge)

	s.who = users.Account{ID: 2, Name: "Ospite", Role: users.User}
	s.do(t, "PUT", path+"it", srt, http.StatusForbidden)

	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM auto_subtitles`).Scan(&n); err != nil || n != 0 {
		t.Errorf("rows = %d, %v", n, err)
	}
}
