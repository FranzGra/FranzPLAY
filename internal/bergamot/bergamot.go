// Package bergamot translates subtitles on this machine, with no other
// container and no account: Bergamot, the translator inside Firefox, comes
// with FranzPLAY's image as the program translator-cli, and its models are
// downloaded the first time they are needed. The program runs only while it
// translates, on one processor core, and needs some 200 MB of memory then.
package bergamot

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/autosubs"
	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// Help is what the administrator needs to know of this translator. It only
// is off where FranzPLAY does not run from its image.
var Help = struct{ Off, Down, Setup, After string }{
	Off: "Questa installazione non contiene il programma translator-cli che traduce. " +
		"Nell'immagine Docker di FranzPLAY c'è già: usa quella, oppure indica dov'è " +
		"nell'impostazione FRANZPLAY_TRANSLATOR.",
}

// batchSize is how many sentences the program gets each time it starts. It
// loads its model at every start, about a second on a small processor, so not
// too few; and it says how far it is only at the end, and that small processor
// does ten sentences a second, so not too many.
const batchSize = 200

// english is the language between two others: there are models only to and
// from it.
const english = "en"

// languages are the ones FranzPLAY offers; the first is the one in between.
var languages = []string{english, "it", "es", "fr", "de"}

// Engine translates with translator-cli and keeps its models in the data
// folder. FranzPLAY's queue does one translation at a time, so one program
// runs at a time.
type Engine struct {
	program string // the path of translator-cli
	dataDir string
	records string // where the list of the models is
	client  *http.Client
	changed func() // tells the pages how a download goes
	logger  *slog.Logger

	mu  sync.Mutex
	now *download // the download going on; nil: none
}

// New returns an engine using a program and the models in dataDir. changed
// is called as a download goes on.
func New(program, dataDir string, changed func(), logger *slog.Logger) *Engine {
	return &Engine{program: program, dataDir: dataDir, records: RecordsURL,
		client: &http.Client{Timeout: downloadTimeout}, changed: changed, logger: logger}
}

// Languages lists the languages it translates. It needs nothing else: the
// models come when they are asked for.
func (e *Engine) Languages(context.Context) ([]string, error) {
	return languages, nil
}

// BatchSize says how many sentences it wants at a time.
func (e *Engine) BatchSize() int { return batchSize }

// route is the models it takes, in order, to go from a language to another:
// between two languages other than English, through English.
func route(from, to string) []string {
	if from == english || to == english {
		return []string{from + "-" + to}
	}
	return []string{from + "-" + english, english + "-" + to}
}

// Cues translates cues, times untouched, from one language to another.
func (e *Engine) Cues(ctx context.Context, cues []video.Cue, from, to string) ([]video.Cue, error) {
	pieces := split(cues)
	lines := texts(pieces)
	for _, pair := range route(from, to) {
		var err error
		if lines, err = e.run(ctx, pair, lines); err != nil {
			return nil, fmt.Errorf("translate %s to %s: %w", from, to, err)
		}
	}
	return join(cues, pieces, lines), nil
}

// stopGrace is how long the program has to end once it is told to stop.
const stopGrace = 5 * time.Second

// errOutput is what the program said when it failed: the end is enough.
const errOutput = 400

// run gives lines to the program and reads as many back, for one model.
func (e *Engine) run(ctx context.Context, pair string, lines []string) ([]string, error) {
	if len(lines) == 0 {
		return nil, nil
	}
	cmd := exec.CommandContext(ctx, e.program, "--model-config-paths", configFile(e.dataDir, pair), "--cpu-threads", "1")
	cmd.Stdin = strings.NewReader(strings.Join(lines, "\n") + "\n")
	var out, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &stderr
	cmd.WaitDelay = stopGrace
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		said := strings.TrimSpace(stderr.String())
		return nil, fmt.Errorf("translator-cli %s: %w: %s", pair, err, said[max(0, len(said)-errOutput):])
	}
	translated := strings.Split(strings.TrimSuffix(out.String(), "\n"), "\n")
	if len(translated) != len(lines) {
		// Never put a sentence on the times of another.
		return nil, fmt.Errorf("translator-cli %s: %d lines for %d: %w", pair, len(translated), len(lines), errLines)
	}
	return translated, nil
}

// errLines means the program did not answer line by line.
var errLines = errors.New("the lines do not match")

var (
	_ media.Translator = (*Engine)(nil)
	_ media.Preparer   = (*Engine)(nil)
	_ media.Batcher    = (*Engine)(nil)

	_ autosubs.Languages        = (*Engine)(nil)
	_ autosubs.TranslatorModels = (*Engine)(nil)
)
