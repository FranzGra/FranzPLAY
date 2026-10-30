package autosubs

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"
)

const askEnToIt = `{"source":"auto","from":"en","to":["it"],"redo":false}`

// withWhisper adds a video with whisper's English subtitles.
func (s *site) withWhisper(t *testing.T) (id int64, path string) {
	t.Helper()
	id = s.addVideo(t, "mare.mp4", "Mare")
	s.exec(t, `INSERT INTO auto_subtitles (video_id, lang, translated_from, model, fingerprint, file, made_at)
		VALUES (?, 'en', '', 'small', 'fp-mare.mp4', 'a.vtt', 1)`, id)
	return id, "/api/admin/subtitles/" + strconv.FormatInt(id, 10)
}

func TestTranslationAskAndTakeBack(t *testing.T) {
	s := newSite(t)
	id, path := s.withWhisper(t)
	s.do(t, "PUT", path+"/translation", askEnToIt, http.StatusNoContent)
	if s.queued != 1 {
		t.Errorf("queued %d times, want 1", s.queued)
	}
	got := decode[listAnswer](t, s.do(t, "GET", "/api/admin/subtitles", "", http.StatusOK))
	tr := got.Videos[0].Translation
	if tr == nil || tr.Source != FromAuto || tr.From != "en" || !reflect.DeepEqual(tr.To, []string{"it"}) || tr.State != "pending" {
		t.Errorf("translation %+v", tr)
	}
	// No listening was asked: only the job of translating.
	var listening int
	if err := s.db.QueryRow(`SELECT count(*) FROM jobs WHERE video_id = ? AND kind = 'transcribe'`, id).Scan(&listening); err != nil {
		t.Fatal(err)
	}
	if listening != 0 {
		t.Errorf("%d transcribe jobs", listening)
	}

	s.do(t, "DELETE", path+"/translation", "", http.StatusNoContent)
	got = decode[listAnswer](t, s.do(t, "GET", "/api/admin/subtitles", "", http.StatusOK))
	if got.Videos[0].Translation != nil {
		t.Errorf("still there: %+v", got.Videos[0].Translation)
	}
	s.do(t, "DELETE", path+"/translation", "", http.StatusNotFound)
}

func TestTranslationRefuses(t *testing.T) {
	s := newSite(t)
	_, path := s.withWhisper(t)
	for name, body := range map[string]string{
		"not json":         `oops`,
		"unknown field":    `{"source":"auto","from":"en","to":["it"],"colour":"red"}`,
		"odd source":       `{"source":"web","from":"en","to":["it"]}`,
		"odd from":         `{"source":"auto","from":"english","to":["it"]}`,
		"no target":        `{"source":"auto","from":"en","to":[]}`,
		"target is from":   `{"source":"auto","from":"en","to":["en"]}`,
		"target twice":     `{"source":"auto","from":"en","to":["it","it"]}`,
		"odd target":       `{"source":"auto","from":"en","to":["xx"]}`,
		"translator lacks": `{"source":"auto","from":"en","to":["de"]}`,
	} {
		t.Run(name, func(t *testing.T) {
			s.do(t, "PUT", path+"/translation", body, http.StatusBadRequest)
		})
	}
	s.do(t, "PUT", "/api/admin/subtitles/999/translation", askEnToIt, http.StatusNotFound)
	// No such subtitles to start from.
	s.do(t, "PUT", path+"/translation", `{"source":"file","from":"en","to":["it"]}`, http.StatusConflict)
	s.do(t, "PUT", path+"/translation", `{"source":"auto","from":"it","to":["en"]}`, http.StatusConflict)

	// The translator off, or not answering, is said as such.
	s.opts.Translator = nil
	s.do(t, "PUT", path+"/translation", askEnToIt, http.StatusServiceUnavailable)
	s.opts.Translator = fakeLanguages{err: errors.New("connection refused")}
	s.do(t, "PUT", path+"/translation", askEnToIt, http.StatusServiceUnavailable)
}

func TestTranslationWaitsForWhisper(t *testing.T) {
	s := newSite(t)
	id, path := s.withWhisper(t)
	s.exec(t, `INSERT INTO jobs (video_id, kind, state, updated_at) VALUES (?, 'transcribe', 'running', 5)`, id)
	s.do(t, "PUT", path+"/translation", askEnToIt, http.StatusConflict)
}

func TestTranslationKeepsWhatIsPresent(t *testing.T) {
	s := newSite(t)
	id, path := s.withWhisper(t)
	if err := os.WriteFile(filepath.Join(s.library, "mare.fr.srt"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	s.opts.Translator = fakeLanguages{known: []string{"en", "it", "fr", "de"}}
	s.exec(t, `INSERT INTO auto_subtitles (video_id, lang, translated_from, model, fingerprint, file, made_at)
		VALUES (?, 'it', 'en', 'small', 'fp-mare.mp4', 'b.vtt', 1)`, id)

	// Already translated: only when redoing.
	s.do(t, "PUT", path+"/translation", askEnToIt, http.StatusConflict)
	s.do(t, "PUT", path+"/translation", `{"source":"auto","from":"en","to":["it"],"redo":true}`, http.StatusNoContent)
	// A file next to the video is never replaced, even when redoing.
	s.do(t, "PUT", path+"/translation", `{"source":"auto","from":"en","to":["fr"],"redo":true}`, http.StatusConflict)
	// The file can be what it starts from.
	s.do(t, "PUT", path+"/translation", `{"source":"file","from":"fr","to":["de"]}`, http.StatusNoContent)
	// A whisper transcript as target, the same.
	s.do(t, "PUT", path+"/translation", `{"source":"file","from":"fr","to":["en"],"redo":true}`, http.StatusConflict)
}

func TestAskTranscriptionForgetsTranslation(t *testing.T) {
	s := newSite(t)
	_, path := s.withWhisper(t)
	s.do(t, "PUT", path+"/translation", askEnToIt, http.StatusNoContent)
	s.do(t, "PUT", path, `{"spoken":"en","model":"small"}`, http.StatusNoContent)
	got := decode[listAnswer](t, s.do(t, "GET", "/api/admin/subtitles", "", http.StatusOK))
	if got.Videos[0].Translation != nil {
		t.Errorf("translation still asked: %+v", got.Videos[0].Translation)
	}
}

func TestAskRefusesTranslatingOverAFile(t *testing.T) {
	s := newSite(t)
	id := s.addVideo(t, "lago.mp4", "Lago")
	if err := os.WriteFile(filepath.Join(s.library, "lago.it.srt"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	path := "/api/admin/subtitles/" + strconv.FormatInt(id, 10)
	s.do(t, "PUT", path, `{"spoken":"en","model":"small","translate":["it"]}`, http.StatusConflict)
}

func TestListSaysAudioLanguages(t *testing.T) {
	s := newSite(t)
	id := s.addVideo(t, "lago.mp4", "Lago")
	s.exec(t, `INSERT INTO video_audio (video_id, stream, lang, title, codec, channels, is_default) VALUES
		(?, 1, 'ita', '', 'aac', 2, 0), (?, 2, 'eng', '', 'aac', 2, 1), (?, 3, 'und', '', 'aac', 2, 0)`, id, id, id)
	got := decode[listAnswer](t, s.do(t, "GET", "/api/admin/subtitles", "", http.StatusOK))
	if want := []string{"en", "it"}; !reflect.DeepEqual(got.Videos[0].AudioLangs, want) {
		t.Errorf("audio %v, want %v", got.Videos[0].AudioLangs, want)
	}
}

// modelsTranslator is a translator with models of its own.
type modelsTranslator struct {
	fakeLanguages
}

func (modelsTranslator) ModelInfo() ModelInfo {
	return ModelInfo{Have: []string{"en-it"}, Name: "it-en", Done: 5, Total: 10}
}

func TestSetupSaysWhichModelsTheTranslatorHas(t *testing.T) {
	s := newSite(t)
	plain := decode[Setup](t, s.do(t, "GET", "/api/admin/subtitles/setup", "", http.StatusOK))
	if plain.TranslatorModels != nil {
		t.Errorf("a translator without models: %+v", plain.TranslatorModels)
	}
	engine := modelsTranslator{fakeLanguages{known: []string{"en", "it"}}}
	s.opts.Translator, s.opts.TranslatorModels = engine, engine
	got := decode[Setup](t, s.do(t, "GET", "/api/admin/subtitles/setup", "", http.StatusOK))
	if got.TranslatorModels == nil || got.TranslatorModels.Name != "it-en" ||
		!reflect.DeepEqual(got.TranslatorModels.Have, []string{"en-it"}) {
		t.Errorf("models %+v", got.TranslatorModels)
	}
}
