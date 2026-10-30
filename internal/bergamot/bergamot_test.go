package bergamot

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// fakeMode makes this test program play translator-cli: it marks every line
// with the name of the model, or does what the mode says.
const fakeMode = "FRANZPLAY_FAKE_TRANSLATOR"

func TestMain(m *testing.M) {
	if mode := os.Getenv(fakeMode); mode != "" {
		fakeTranslator(mode)
		return
	}
	os.Exit(m.Run())
}

func fakeTranslator(mode string) {
	pair := filepath.Base(filepath.Dir(os.Args[2]))
	if os.Args[3] != "--cpu-threads" || os.Args[4] != "1" {
		fmt.Fprintln(os.Stderr, "wrong threads")
		os.Exit(3)
	}
	lines := bufio.NewScanner(os.Stdin)
	switch mode {
	case "fail":
		fmt.Fprintln(os.Stderr, "the model is broken")
		os.Exit(2)
	case "short":
		fmt.Println("only one")
		return
	}
	for lines.Scan() {
		fmt.Println(pair + ":" + lines.Text())
	}
}

func fakeEngine(t *testing.T, mode string) *Engine {
	t.Helper()
	t.Setenv(fakeMode, mode)
	program, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return New(program, t.TempDir(), nil, slog.New(slog.DiscardHandler))
}

func cuesOf(texts ...string) []video.Cue {
	out := make([]video.Cue, len(texts))
	for i, text := range texts {
		out[i] = video.Cue{Start: time.Duration(i) * time.Second, End: time.Duration(i+1) * time.Second, Text: text}
	}
	return out
}

func textsOf(cues []video.Cue) []string {
	out := make([]string, len(cues))
	for i, c := range cues {
		out[i] = c.Text
	}
	return out
}

func TestCuesKeepEverySentenceInItsPlace(t *testing.T) {
	e := fakeEngine(t, "marks")
	cues := cuesOf(
		"Hello there.",
		"A sentence\nthat goes on.",
		"- Are you?\n- Yes.",
		"<i>In italics.</i>",
		"<i>Two lines\nin italics.</i>",
		"{\\an8}Up here.",
		"♪",
		"...",
		"",
		"A <b>bold</b> word.",
		"With\r\nodd breaks.",
	)
	got, err := e.Cues(context.Background(), cues, "en", "it")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"en-it:Hello there.",
		"en-it:A sentence that goes on.",
		"- en-it:Are you?\n- en-it:Yes.",
		"<i>en-it:In italics.</i>",
		"<i>en-it:Two lines in italics.</i>",
		"{\\an8}en-it:Up here.",
		"♪",
		"...",
		"",
		"en-it:A bold word.",
		"en-it:With odd breaks.",
	}
	if diff := textsOf(got); !reflect.DeepEqual(diff, want) {
		t.Errorf("got  %q\nwant %q", diff, want)
	}
	for i := range got {
		if got[i].Start != cues[i].Start || got[i].End != cues[i].End {
			t.Errorf("cue %d: times changed", i)
		}
	}
}

func TestBetweenTwoOtherLanguagesItGoesThroughEnglish(t *testing.T) {
	e := fakeEngine(t, "marks")
	got, err := e.Cues(context.Background(), cuesOf("Bonjour"), "fr", "it")
	if err != nil {
		t.Fatal(err)
	}
	if want := "en-it:fr-en:Bonjour"; got[0].Text != want {
		t.Errorf("got %q, want %q", got[0].Text, want)
	}
}

func TestOnlyMarksNeedNoProgram(t *testing.T) {
	e := New(filepath.Join(t.TempDir(), "none"), t.TempDir(), nil, slog.New(slog.DiscardHandler))
	got, err := e.Cues(context.Background(), cuesOf("♪♪", "<i>...</i>"), "en", "it")
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"♪♪", "<i>...</i>"}; !reflect.DeepEqual(textsOf(got), want) {
		t.Errorf("got %q", textsOf(got))
	}
}

func TestProgramThatFailsSaysWhy(t *testing.T) {
	e := fakeEngine(t, "fail")
	_, err := e.Cues(context.Background(), cuesOf("Hello"), "en", "it")
	if err == nil || !strings.Contains(err.Error(), "the model is broken") {
		t.Errorf("error %v", err)
	}
}

func TestLinesThatDoNotMatchAreAnError(t *testing.T) {
	e := fakeEngine(t, "short")
	_, err := e.Cues(context.Background(), cuesOf("One", "Two"), "en", "it")
	if !errors.Is(err, errLines) {
		t.Errorf("error %v", err)
	}
}

func TestAnEmptyTranslationKeepsTheOriginal(t *testing.T) {
	if got := orOriginal("   ", "Hello"); got != "Hello" {
		t.Errorf("got %q", got)
	}
}

func rec(from, to, version, kind string) record {
	r := record{FromLang: from, ToLang: to, Version: version, FileType: kind}
	r.Attachment.Location = version + "/" + kind
	return r
}

func TestPickTakesTheHighestFinishedWholeVersion(t *testing.T) {
	var records []record
	for _, kind := range []string{"model", "vocab", "lex"} {
		records = append(records, rec("en", "it", "2.9", kind), rec("en", "it", "2.10", kind),
			rec("en", "it", "3.0a1", kind), rec("it", "en", "9.0", kind))
	}
	records = append(records, rec("en", "it", "4.0", "model")) // not whole
	nightly := rec("en", "it", "5.0", "model")
	nightly.Filter = "env.channel == 'nightly'"
	records = append(records, nightly)

	files, err := pick(records, "en-it")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		if f.Version != "2.10" {
			t.Errorf("picked %s", f.Version)
		}
	}
	if _, err := pick(records, "en-de"); !errors.Is(err, media.ErrRefused) {
		t.Errorf("unknown pair: %v", err)
	}
}

// modelServer plays the list and the files of the models.
func modelServer(t *testing.T, change func(kind string, body []byte) []byte) *httptest.Server {
	t.Helper()
	bodies := map[string][]byte{"model": []byte("the model"), "vocab": []byte("the vocabulary"), "lex": []byte("the words")}
	var srv *httptest.Server
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/{$}", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprintf(w, `{"capabilities":{"attachments":{"base_url":%q}}}`, srv.URL+"/files/")
	})
	mux.HandleFunc("GET /v1/buckets/x", func(w http.ResponseWriter, _ *http.Request) {
		var records []record
		for kind, body := range bodies {
			sum := sha256.Sum256(body)
			r := rec("en", "it", "2.1", kind)
			r.Attachment.Hash, r.Attachment.Size = hex.EncodeToString(sum[:]), int64(len(body))
			r.Attachment.Location = kind
			records = append(records, r)
		}
		if err := json.NewEncoder(w).Encode(map[string]any{"data": records}); err != nil {
			t.Error(err)
		}
	})
	mux.HandleFunc("GET /files/{kind}", func(w http.ResponseWriter, r *http.Request) {
		kind := r.PathValue("kind")
		if _, err := w.Write(change(kind, bodies[kind])); err != nil {
			t.Error(err)
		}
	})
	srv = httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

// recordsOf is the address of the list on a server, with its root before
// /buckets/ like the real one.
func recordsOf(srv *httptest.Server) string {
	return srv.URL + "/v1/buckets/x"
}

func TestPrepareDownloadsTheModelOnce(t *testing.T) {
	calls := 0
	srv := modelServer(t, func(_ string, body []byte) []byte { calls++; return body })
	e := fakeEngine(t, "marks")
	e.client = srv.Client()
	e.records = recordsOf(srv)

	var stages []string
	ctx := jobs.WithReporter(context.Background(), func(p jobs.Progress) { stages = append(stages, p.Stage) })
	if err := e.Prepare(ctx, "en", "it"); err != nil {
		t.Fatal(err)
	}
	if want := []string{"en-it"}; !slices.Equal(e.Models(), want) {
		t.Errorf("models %v", e.Models())
	}
	if len(stages) == 0 || stages[0] != StageModel {
		t.Errorf("stages %v", stages)
	}
	if info := e.ModelInfo(); info.Name != "" || !slices.Equal(info.Have, []string{"en-it"}) {
		t.Errorf("after the download: %+v", info)
	}
	config, err := os.ReadFile(configFile(e.dataDir, "en-it"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(config), "ssplit-mode: sentence") ||
		!strings.Contains(string(config), filepath.ToSlash(filepath.Join(e.dataDir, folder, "en-it", "model.bin"))) {
		t.Errorf("config:\n%s", config)
	}
	first := calls
	if err := e.Prepare(context.Background(), "en", "it"); err != nil {
		t.Fatal(err)
	}
	if calls != first {
		t.Errorf("downloaded again: %d calls after %d", calls, first)
	}
}

func TestPrepareRefusesAFileThatIsNotTheOneOnTheList(t *testing.T) {
	srv := modelServer(t, func(kind string, body []byte) []byte {
		if kind == "lex" {
			return []byte("the wordz")
		}
		return body
	})
	e := fakeEngine(t, "marks")
	e.client = srv.Client()
	e.records = recordsOf(srv)

	if err := e.Prepare(context.Background(), "en", "it"); err == nil {
		t.Fatal("a wrong file was accepted")
	}
	if got := e.Models(); len(got) != 0 {
		t.Errorf("models %v", got)
	}
	left, err := filepath.Glob(filepath.Join(e.dataDir, folder, "*"))
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 0 {
		t.Errorf("left behind: %v", left)
	}
}

func TestLanguagesAndRoutes(t *testing.T) {
	e := fakeEngine(t, "marks")
	known, err := e.Languages(context.Background())
	if err != nil || !slices.Contains(known, "it") || !slices.Contains(known, "en") {
		t.Errorf("languages %v, %v", known, err)
	}
	if got := route("it", "en"); !slices.Equal(got, []string{"it-en"}) {
		t.Errorf("route %v", got)
	}
	if got := route("de", "es"); !slices.Equal(got, []string{"de-en", "en-es"}) {
		t.Errorf("route %v", got)
	}
}
