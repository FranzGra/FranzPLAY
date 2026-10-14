package media

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/translate"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// heardItalian is what the fake whisper writes: Italian, two cues.
const heardItalian = `{"result": {"language": "it"}, "transcription": [
	{"offsets": {"from": 1000, "to": 2000}, "text": " Ciao a tutti."},
	{"offsets": {"from": 2000, "to": 3500}, "text": " Andiamo al mare."}]}`

// fakeTranslator writes the text in upper case, or fails with err.
type fakeTranslator struct {
	calls []string // "it>en"
	err   error
}

func (f *fakeTranslator) Cues(_ context.Context, cues []video.Cue, from, to string) ([]video.Cue, error) {
	f.calls = append(f.calls, from+">"+to)
	if f.err != nil {
		return nil, f.err
	}
	out := slices.Clone(cues)
	for i := range out {
		out[i].Text = strings.ToUpper(to) + ": " + out[i].Text
	}
	return out, nil
}

type transcribeFixture struct {
	db      *sql.DB
	id      int64
	dataDir string
	tr      *Transcriber
	tl      *fakeTranslator
	heard   string     // what whisper writes
	whisper [][]string // the arguments of each whisper run
	ffmpeg  [][]string
	during  func() // runs while whisper works
	fail    string // the program that fails
}

func newTranscribeFixture(t *testing.T) *transcribeFixture {
	t.Helper()
	db, id := catalog(t, "/videos", "film.mkv")
	fx := &transcribeFixture{db: db, id: id, dataDir: t.TempDir(), tl: &fakeTranslator{}, heard: heardItalian}
	fx.tr = NewTranscriber(db, "ffmpeg", "whisper-cli", fx.dataDir, fx.tl)
	fx.tr.now = func() time.Time { return time.Unix(1_800_000_000, 0) }
	fx.tr.run = func(_ context.Context, program string, args ...string) ([]byte, error) {
		if program == fx.fail {
			return nil, errors.New("exit status 1")
		}
		switch program {
		case "ffmpeg":
			fx.ffmpeg = append(fx.ffmpeg, args)
			return nil, os.WriteFile(strings.TrimPrefix(args[len(args)-1], "file:"), []byte("RIFF"), 0o600)
		case "whisper-cli":
			fx.whisper = append(fx.whisper, args)
			if fx.during != nil {
				fx.during()
			}
			out := args[slices.Index(args, "-of")+1]
			return nil, os.WriteFile(out+".json", []byte(fx.heard), 0o600)
		}
		return nil, errors.New("unknown program " + program)
	}
	fx.model(t, "small")
	return fx
}

func (fx *transcribeFixture) model(t *testing.T, name string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(fx.dataDir, WhisperDir), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ModelFile(fx.dataDir, name), []byte("model"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func (fx *transcribeFixture) ask(t *testing.T, spoken, model, langs string) {
	t.Helper()
	if _, err := fx.db.Exec(`INSERT INTO subtitle_requests (video_id, spoken, model, langs, requested_at)
		VALUES (?, ?, ?, ?, 1) ON CONFLICT (video_id) DO UPDATE
		SET spoken = excluded.spoken, model = excluded.model, langs = excluded.langs`,
		fx.id, spoken, model, langs); err != nil {
		t.Fatal(err)
	}
}

// made lists the subtitles saved: "it<-" for whisper's, "en<-it".
func (fx *transcribeFixture) made(t *testing.T) (got []string, files map[string]string) {
	t.Helper()
	rows, err := fx.db.Query(`SELECT lang, translated_from, file FROM auto_subtitles WHERE video_id = ? ORDER BY lang`, fx.id)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			t.Error(err)
		}
	}()
	files = map[string]string{}
	for rows.Next() {
		var lang, from, file string
		if err := rows.Scan(&lang, &from, &file); err != nil {
			t.Fatal(err)
		}
		got = append(got, lang+"<-"+from)
		data, err := os.ReadFile(filepath.Join(fx.dataDir, AutoSubtitlesDir, file))
		if err != nil {
			t.Fatal(err)
		}
		files[lang] = string(data)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return got, files
}

// files lists what is in the autosubtitles folder.
func (fx *transcribeFixture) files(t *testing.T) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(fx.dataDir, AutoSubtitlesDir))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

func (fx *transcribeFixture) stage(t *testing.T) string {
	t.Helper()
	var stage string
	if err := fx.db.QueryRow(`SELECT stage FROM subtitle_requests WHERE video_id = ?`, fx.id).Scan(&stage); err != nil {
		t.Fatal(err)
	}
	return stage
}

func TestTranscribeAndTranslate(t *testing.T) {
	fx := newTranscribeFixture(t)
	fx.ask(t, "", "small", "it,en")
	var stages []string
	fx.tr.OnStage(func() { stages = append(stages, fx.stage(t)) })
	if err := fx.tr.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	got, files := fx.made(t)
	if want := []string{"en<-it", "it<-"}; !reflect.DeepEqual(got, want) {
		t.Errorf("made %v, want %v", got, want)
	}
	if want := "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nCiao a tutti.\n\n00:00:02.000 --> 00:00:03.500\nAndiamo al mare.\n"; files["it"] != want {
		t.Errorf("it = %q", files["it"])
	}
	if !strings.Contains(files["en"], "EN: Ciao a tutti.") {
		t.Errorf("en = %q", files["en"])
	}
	if len(fx.files(t)) != 2 {
		t.Errorf("files %v: the sound should be gone", fx.files(t))
	}
	if want := []string{"audio", "transcribe", "translate", ""}; !reflect.DeepEqual(stages, want) {
		t.Errorf("stages %v, want %v", stages, want)
	}
	if args := fx.whisper[0]; args[slices.Index(args, "-l")+1] != "auto" || args[slices.Index(args, "-m")+1] != ModelFile(fx.dataDir, "small") {
		t.Errorf("whisper %v", args)
	}
	if args := fx.ffmpeg[0]; args[slices.Index(args, "-map")+1] != "0:a:0" || args[4] != "file:/videos/film.mkv" {
		t.Errorf("ffmpeg %v", args)
	}
}

func TestTranscribeOneMoreLanguage(t *testing.T) {
	fx := newTranscribeFixture(t)
	fx.ask(t, "", "small", "en")
	if err := fx.tr.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	fx.ask(t, "", "small", "en,de")
	if err := fx.tr.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if len(fx.whisper) != 1 {
		t.Errorf("whisper ran %d times, want once", len(fx.whisper))
	}
	if want := []string{"it>en", "it>de"}; !reflect.DeepEqual(fx.tl.calls, want) {
		t.Errorf("translations %v, want %v", fx.tl.calls, want)
	}
	if got, _ := fx.made(t); !reflect.DeepEqual(got, []string{"de<-it", "en<-it", "it<-"}) {
		t.Errorf("made %v", got)
	}
}

func TestTranscribeAgainWithAnotherModel(t *testing.T) {
	fx := newTranscribeFixture(t)
	fx.model(t, "medium")
	fx.ask(t, "", "small", "it,en")
	if err := fx.tr.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	_, before := fx.made(t)
	fx.ask(t, "it", "medium", "it,en")
	fx.heard = strings.ReplaceAll(heardItalian, "mare", "lago")
	fx.tr.now = func() time.Time { return time.Unix(1_800_000_100, 0) }
	if err := fx.tr.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	got, after := fx.made(t)
	if !reflect.DeepEqual(got, []string{"en<-it", "it<-"}) || after["en"] == before["en"] || !strings.Contains(after["en"], "lago") {
		t.Errorf("made %v: %q", got, after["en"])
	}
	if len(fx.files(t)) != 2 {
		t.Errorf("files %v: the old ones should be gone", fx.files(t))
	}
	if args := fx.whisper[1]; args[slices.Index(args, "-l")+1] != "it" {
		t.Errorf("whisper %v", args)
	}
}

func TestTranscribePicksTheSpokenTrack(t *testing.T) {
	fx := newTranscribeFixture(t)
	if _, err := fx.db.Exec(`INSERT INTO video_audio (video_id, stream, lang, title, codec, channels, is_default)
		VALUES (?, 1, 'eng', '', 'aac', 2, 1), (?, 2, 'ita', '', 'aac', 2, 0)`, fx.id, fx.id); err != nil {
		t.Fatal(err)
	}
	for spoken, want := range map[string]string{"it": "0:2", "": "0:1", "fr": "0:1"} {
		fx.ffmpeg = nil
		fx.ask(t, spoken, "small", "")
		if _, err := fx.db.Exec(`DELETE FROM auto_subtitles`); err != nil {
			t.Fatal(err)
		}
		if err := fx.tr.Handle(context.Background(), fx.id); err != nil {
			t.Fatal(err)
		}
		if args := fx.ffmpeg[0]; args[slices.Index(args, "-map")+1] != want {
			t.Errorf("spoken %q: ffmpeg %v, want track %s", spoken, args, want)
		}
	}
}

func TestTranscribeFailures(t *testing.T) {
	tests := []struct {
		name      string
		prepare   func(t *testing.T, fx *transcribeFixture)
		permanent bool
		made      []string // what stays saved
	}{
		{"no translator", func(_ *testing.T, fx *transcribeFixture) { fx.tr.translator = nil }, true, []string{"it<-"}},
		{"translator refuses", func(_ *testing.T, fx *transcribeFixture) {
			fx.tl.err = translate.ErrRefused
		}, true, []string{"it<-"}},
		{"translator busy", func(_ *testing.T, fx *transcribeFixture) {
			fx.tl.err = errors.New("answered 500")
		}, false, []string{"it<-"}},
		{"model missing", func(_ *testing.T, fx *transcribeFixture) { fx.ask(t, "", "medium", "it,en") }, true, nil},
		{"ffmpeg fails", func(_ *testing.T, fx *transcribeFixture) { fx.fail = "ffmpeg" }, false, nil},
		{"whisper fails", func(_ *testing.T, fx *transcribeFixture) { fx.fail = "whisper-cli" }, false, nil},
		{"whisper writes nonsense", func(_ *testing.T, fx *transcribeFixture) { fx.heard = "oops" }, false, nil},
		{"nobody speaks", func(_ *testing.T, fx *transcribeFixture) {
			fx.heard = `{"result": {"language": "en"}, "transcription": [{"text": "[BLANK_AUDIO]"}]}`
		}, true, nil},
		{"no sound", func(t *testing.T, fx *transcribeFixture) {
			if _, err := fx.db.Exec(`UPDATE videos SET audio_codec = '' WHERE id = ?`, fx.id); err != nil {
				t.Fatal(err)
			}
		}, true, nil},
		{"video changes meanwhile", func(t *testing.T, fx *transcribeFixture) {
			fx.during = func() {
				if _, err := fx.db.Exec(`UPDATE videos SET fingerprint = 'other' WHERE id = ?`, fx.id); err != nil {
					t.Error(err)
				}
			}
		}, true, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fx := newTranscribeFixture(t)
			fx.ask(t, "", "small", "it,en")
			tt.prepare(t, fx)
			err := fx.tr.Handle(context.Background(), fx.id)
			if err == nil {
				t.Fatal("no error")
			}
			if errors.Is(err, jobs.ErrPermanent) != tt.permanent {
				t.Errorf("err = %v, permanent should be %v", err, tt.permanent)
			}
			got, _ := fx.made(t)
			if !reflect.DeepEqual(got, tt.made) {
				t.Errorf("made %v, want %v", got, tt.made)
			}
			if files := fx.files(t); len(files) != len(tt.made) {
				t.Errorf("files %v", files)
			}
			if fx.stage(t) != "" {
				t.Errorf("stage %q, want none", fx.stage(t))
			}
		})
	}
}

func TestTranscribeTakenBackMeanwhile(t *testing.T) {
	fx := newTranscribeFixture(t)
	fx.ask(t, "", "small", "it,en")
	fx.during = func() {
		if _, err := fx.db.Exec(`DELETE FROM subtitle_requests`); err != nil {
			t.Error(err)
		}
	}
	if err := fx.tr.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if got, _ := fx.made(t); got != nil {
		t.Errorf("made %v, want nothing", got)
	}
	if files := fx.files(t); len(files) != 0 {
		t.Errorf("files %v", files)
	}
}

func TestTranscribeNothingAsked(t *testing.T) {
	fx := newTranscribeFixture(t)
	if err := fx.tr.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if len(fx.ffmpeg)+len(fx.whisper) != 0 {
		t.Error("ran a program with nothing asked")
	}
}

func TestModels(t *testing.T) {
	dir := t.TempDir()
	if got, err := Models(dir); err != nil || got != nil {
		t.Errorf("no folder: %v, %v", got, err)
	}
	if err := os.MkdirAll(filepath.Join(dir, WhisperDir, "ggml-dir.bin"), 0o750); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"ggml-small.bin", "ggml-medium.bin", "ggml-silero-v5.1.2.bin", "notes.txt"} {
		if err := os.WriteFile(filepath.Join(dir, WhisperDir, name), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	got, err := Models(dir)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"medium", "small"}; !reflect.DeepEqual(got, want) {
		t.Errorf("Models = %v, want %v", got, want)
	}
}

func TestRemoveOrphanAutoSubtitles(t *testing.T) {
	fx := newTranscribeFixture(t)
	fx.ask(t, "", "small", "it")
	if err := fx.tr.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(fx.dataDir, AutoSubtitlesDir)
	for _, name := range []string{"old.vtt", ".new-123"} {
		if err := os.WriteFile(filepath.Join(dir, name), nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	n, err := RemoveOrphanAutoSubtitles(context.Background(), fx.db, fx.dataDir)
	if err != nil || n != 2 {
		t.Errorf("removed %d, %v; want 2", n, err)
	}
	if files := fx.files(t); len(files) != 1 {
		t.Errorf("files %v", files)
	}
}
