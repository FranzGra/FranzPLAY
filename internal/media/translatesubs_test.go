package media

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

const someVTT = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<i>Hello</i> there.\n\n00:00:02.000 --> 00:00:03.000\nGoodbye.\n"

// askTranslation saves a request to translate.
func (fx *transcribeFixture) askTranslation(t *testing.T, source, from, langs string, redo bool, at int64) {
	t.Helper()
	if _, err := fx.db.Exec(`INSERT INTO translation_requests (video_id, source, from_lang, langs, redo, requested_at)
		VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (video_id) DO UPDATE SET source = excluded.source,
		from_lang = excluded.from_lang, langs = excluded.langs, redo = excluded.redo, requested_at = excluded.requested_at`,
		fx.id, source, from, langs, redo, at); err != nil {
		t.Fatal(err)
	}
}

// heard has whisper's Italian subtitles made, without any translation.
func (fx *transcribeFixture) heardOnce(t *testing.T) {
	t.Helper()
	fx.ask(t, "it", "small", "")
	if err := fx.tr.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
}

func TestTranslationFromWhisperNeverListens(t *testing.T) {
	fx := newTranscribeFixture(t)
	fx.heardOnce(t)
	listened, extracted := len(fx.whisper), len(fx.ffmpeg)
	fx.askTranslation(t, FromWhisper, "it", "en,de", false, 1_800_000_100)
	var seen []jobs.Progress
	ctx := jobs.WithReporter(context.Background(), func(p jobs.Progress) { seen = append(seen, p) })
	if err := fx.tr.HandleTranslation(ctx, fx.id); err != nil {
		t.Fatal(err)
	}
	if len(fx.whisper) != listened || len(fx.ffmpeg) != extracted {
		t.Errorf("listened again: whisper %d, ffmpeg %d", len(fx.whisper), len(fx.ffmpeg))
	}
	if got, _ := fx.made(t); !reflect.DeepEqual(got, []string{"de<-it", "en<-it", "it<-"}) {
		t.Errorf("made %v", got)
	}
	last := seen[len(seen)-1]
	if last.Stage != string(StageTranslate) || last.Percent != 100 || last.Done != 4 || last.Total != 4 {
		t.Errorf("progress %+v", last)
	}
	// It goes up, across the languages.
	if first := seen[0]; first.Percent != 0 || first.Total != 4 {
		t.Errorf("first progress %+v", first)
	}
}

func TestTranslationFromFileNextToTheVideo(t *testing.T) {
	fx := newTranscribeFixture(t)
	dir := t.TempDir()
	if _, err := fx.db.Exec(`UPDATE libraries SET path = ?`, dir); err != nil {
		t.Fatal(err)
	}
	srt := "1\n00:00:01,000 --> 00:00:02,000\n<i>Hello</i> there.\n\n"
	if err := os.WriteFile(filepath.Join(dir, "film.en.srt"), []byte(srt), 0o600); err != nil {
		t.Fatal(err)
	}
	fx.askTranslation(t, FromFile, "en", "it", false, 1)
	if err := fx.tr.HandleTranslation(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if len(fx.whisper) != 0 {
		t.Error("whisper ran")
	}
	got, files := fx.made(t)
	if !reflect.DeepEqual(got, []string{"it<-en"}) || !strings.Contains(files["it"], "IT: <i>Hello</i> there.") {
		t.Errorf("made %v: %q", got, files["it"])
	}
	// The file next to the video stays as it was (rule 1).
	if data, err := os.ReadFile(filepath.Join(dir, "film.en.srt")); err != nil || string(data) != srt {
		t.Errorf("file touched: %q, %v", data, err)
	}
}

func TestTranslationFromInsideTheVideo(t *testing.T) {
	fx := newTranscribeFixture(t)
	if err := os.MkdirAll(filepath.Join(fx.dataDir, SubtitlesDir), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(fx.dataDir, SubtitlesDir, "x.vtt"), []byte(someVTT), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.db.Exec(`INSERT INTO video_subtitles (video_id, stream, lang, title, forced, file)
		VALUES (?, 2, 'eng', '', 0, 'x.vtt')`, fx.id); err != nil {
		t.Fatal(err)
	}
	fx.askTranslation(t, FromInside, "en", "it", false, 1)
	if err := fx.tr.HandleTranslation(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	got, files := fx.made(t)
	if !reflect.DeepEqual(got, []string{"it<-en"}) || !strings.Contains(files["it"], "IT: Goodbye.") {
		t.Errorf("made %v: %q", got, files["it"])
	}
}

func TestTranslationKeepsWhatIsThere(t *testing.T) {
	fx := newTranscribeFixture(t)
	fx.heardOnce(t)
	fx.askTranslation(t, FromWhisper, "it", "en", false, 1_800_000_000)
	if err := fx.tr.HandleTranslation(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	fx.tl.calls = nil

	// Asked again without redo: nothing to do.
	if err := fx.tr.HandleTranslation(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if len(fx.tl.calls) != 0 {
		t.Errorf("translated again: %v", fx.tl.calls)
	}

	// With redo it is made again, once: the job starting over skips it.
	fx.tr.now = func() time.Time { return time.Unix(1_800_000_200, 0) }
	fx.askTranslation(t, FromWhisper, "it", "en", true, 1_800_000_100)
	for range 2 {
		if err := fx.tr.HandleTranslation(context.Background(), fx.id); err != nil {
			t.Fatal(err)
		}
	}
	if want := []string{"it>en"}; !reflect.DeepEqual(fx.tl.calls, want) {
		t.Errorf("redo: %v, want %v", fx.tl.calls, want)
	}

	// Whisper's own are never overwritten by a translation.
	fx.tl.calls = nil
	fx.askTranslation(t, FromWhisper, "it", "it", true, 1_900_000_000)
	if err := fx.tr.HandleTranslation(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if len(fx.tl.calls) != 0 {
		t.Errorf("whisper's replaced: %v", fx.tl.calls)
	}
}

func TestTranslationFailures(t *testing.T) {
	tests := []struct {
		name      string
		prepare   func(fx *transcribeFixture)
		permanent bool
	}{
		{"no translator", func(fx *transcribeFixture) { fx.tr.translator = nil }, true},
		{"translator refuses", func(fx *transcribeFixture) { fx.tl.err = ErrRefused }, true},
		{"translator busy", func(fx *transcribeFixture) { fx.tl.err = errors.New("answered 500") }, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fx := newTranscribeFixture(t)
			fx.heardOnce(t)
			fx.askTranslation(t, FromWhisper, "it", "en", false, 1)
			tt.prepare(fx)
			err := fx.tr.HandleTranslation(context.Background(), fx.id)
			if err == nil {
				t.Fatal("no error")
			}
			if errors.Is(err, jobs.ErrPermanent) != tt.permanent {
				t.Errorf("err = %v, permanent should be %v", err, tt.permanent)
			}
			// What whisper wrote stays, whatever happens to the translator.
			if got, _ := fx.made(t); !reflect.DeepEqual(got, []string{"it<-"}) {
				t.Errorf("made %v", got)
			}
		})
	}
	t.Run("nothing to start from", func(t *testing.T) {
		fx := newTranscribeFixture(t)
		fx.askTranslation(t, FromWhisper, "it", "en", false, 1)
		if err := fx.tr.HandleTranslation(context.Background(), fx.id); !errors.Is(err, jobs.ErrPermanent) {
			t.Errorf("err = %v", err)
		}
	})
}

func TestTranslationTakenBackMeanwhile(t *testing.T) {
	fx := newTranscribeFixture(t)
	fx.heardOnce(t)
	fx.askTranslation(t, FromWhisper, "it", "en", false, 1)
	fx.tl.during = func() {
		if _, err := fx.db.Exec(`DELETE FROM translation_requests`); err != nil {
			t.Error(err)
		}
	}
	if err := fx.tr.HandleTranslation(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if got, _ := fx.made(t); !reflect.DeepEqual(got, []string{"it<-"}) {
		t.Errorf("made %v", got)
	}
}

func TestTranslationNothingAsked(t *testing.T) {
	fx := newTranscribeFixture(t)
	if err := fx.tr.HandleTranslation(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
}

// preparingTranslator gets something ready first and wants its own batches.
type preparingTranslator struct {
	fakeTranslator
	prepared []string
	prepare  error
	batches  []int
}

func (p *preparingTranslator) Prepare(_ context.Context, from, to string) error {
	p.prepared = append(p.prepared, from+">"+to)
	return p.prepare
}

func (p *preparingTranslator) BatchSize() int { return 1 }

func (p *preparingTranslator) Cues(ctx context.Context, cues []video.Cue, from, to string) ([]video.Cue, error) {
	p.batches = append(p.batches, len(cues))
	return p.fakeTranslator.Cues(ctx, cues, from, to)
}

func TestTranslatorGetsReadyBeforeTranslating(t *testing.T) {
	fx := newTranscribeFixture(t)
	fx.heardOnce(t)
	p := &preparingTranslator{}
	tr := NewTranscriber(fx.db, "", "", fx.dataDir, p)
	fx.askTranslation(t, FromWhisper, "it", "en", false, 1_800_000_100)
	if err := tr.HandleTranslation(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(p.prepared, []string{"it>en"}) {
		t.Errorf("prepared %v", p.prepared)
	}
	if !reflect.DeepEqual(p.batches, []int{1, 1}) {
		t.Errorf("batches %v", p.batches)
	}
}

func TestTranslatorThatCannotGetReady(t *testing.T) {
	for _, c := range []struct {
		name      string
		err       error
		permanent bool
	}{
		{"it tries again", errors.New("no network"), false},
		{"it gives up", ErrRefused, true},
	} {
		t.Run(c.name, func(t *testing.T) {
			fx := newTranscribeFixture(t)
			fx.heardOnce(t)
			p := &preparingTranslator{prepare: c.err}
			tr := NewTranscriber(fx.db, "", "", fx.dataDir, p)
			fx.askTranslation(t, FromWhisper, "it", "en", false, 1_800_000_100)
			err := tr.HandleTranslation(context.Background(), fx.id)
			if !errors.Is(err, c.err) || errors.Is(err, jobs.ErrPermanent) != c.permanent {
				t.Errorf("error %v", err)
			}
			if len(p.batches) != 0 {
				t.Errorf("translated all the same: %v", p.batches)
			}
		})
	}
}
