package media

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
)

// The builds of whisper.cpp in the amd64 image. A CPU that lacks what the
// complete one needs would die on its first instruction, not fail politely.
const (
	WhisperComplete = "complete" // needs avxFlags below
	WhisperBasic    = "basic"    // needs only SSE4.2; slower, runs on small CPUs
	// whisperBasicSuffix is what the basic program adds to the complete one's
	// name, next to it. A whisper.cpp installed by hand has no such neighbour.
	whisperBasicSuffix = "-basic"
)

// whisperProbeTimeout is how long the check may take: it exits in a moment.
const whisperProbeTimeout = 5 * time.Second

// avxFlags are the words of /proc/cpuinfo for what the complete build needs:
// the ones whisper.cpp turns on when built with GGML_NATIVE=OFF.
var avxFlags = []string{"avx", "avx2", "fma", "f16c", "bmi2"}

// cpuFlags reads the "flags" line of /proc/cpuinfo. nil means not known: a
// system with no such file, or not x86 (ARM calls that line "Features").
func cpuFlags(cpuinfo string) []string {
	for line := range strings.Lines(cpuinfo) {
		name, value, ok := strings.Cut(line, ":")
		if ok && strings.TrimSpace(name) == "flags" {
			return strings.Fields(value)
		}
	}
	return nil
}

// WhisperStatus is what whisper can do on this machine.
type WhisperStatus struct {
	Build   string // WhisperComplete, WhisperBasic, or "": the only one there is
	Runs    bool   // the program starts here
	Problem string // why it does not, in Italian; "" when it does
	SlowCPU bool   // an x86 CPU without AVX2: transcribing takes long
}

// Messages for the administrator: they end up in the job's error too.
const (
	whisperOldCPU = "Questo processore è troppo vecchio per Whisper: non ha le istruzioni SSE4.2 che servono " +
		"anche alla versione di base. I sottotitoli automatici qui non si possono fare."
	whisperCrashed = "Whisper si è fermato subito: questo processore non ha le istruzioni che gli servono " +
		"(errore «illegal instruction»). Riprovare non cambia nulla, a meno che tu non installi una versione adatta."
)

// WhisperPicker chooses the whisper program for this CPU and checks it runs.
// Reading the flags costs nothing and happens at the start; really running
// the program waits until someone asks, and happens once.
type WhisperPicker struct {
	program string // the chosen one
	probe   func(ctx context.Context, program string) error
	once    sync.Once
	mu      sync.Mutex // guards status
	status  WhisperStatus
}

// NewWhisperPicker chooses between program and its basic neighbour, if any.
func NewWhisperPicker(program string) *WhisperPicker {
	// Unreadable, as on Windows and on a Mac: not known, the only program.
	cpuinfo, err := os.ReadFile("/proc/cpuinfo")
	if err != nil {
		cpuinfo = nil
	}
	_, statErr := os.Stat(program + whisperBasicSuffix)
	return newWhisperPicker(program, cpuFlags(string(cpuinfo)), statErr == nil)
}

func newWhisperPicker(program string, flags []string, hasBasic bool) *WhisperPicker {
	p := &WhisperPicker{program: program, probe: probeWhisper, status: WhisperStatus{Runs: true}}
	if flags == nil {
		return p
	}
	complete := !slices.ContainsFunc(avxFlags, func(f string) bool { return !slices.Contains(flags, f) })
	p.status.SlowCPU = !complete
	switch {
	case !hasBasic: // installed by hand: nothing to choose from
	case complete:
		p.status.Build = WhisperComplete
	case slices.Contains(flags, "sse4_2"):
		p.program += whisperBasicSuffix
		p.status.Build = WhisperBasic
	default:
		p.status.Runs, p.status.Problem = false, whisperOldCPU
	}
	return p
}

// Program is the program to run.
func (p *WhisperPicker) Program() string {
	return p.program
}

// Status says what whisper can do here. The first call really starts the
// program, on an empty model: the crash of a CPU without the right
// instructions comes while it starts up, long before it reads anything.
// That takes a moment and no model; the answer is kept.
func (p *WhisperPicker) Status(ctx context.Context) WhisperStatus {
	p.once.Do(func() {
		if p.current().Problem != "" {
			return
		}
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), whisperProbeTimeout)
		defer cancel()
		if isIllegalInstruction(p.probe(ctx, p.program)) {
			p.crashed()
		}
	})
	return p.current()
}

func (p *WhisperPicker) current() WhisperStatus {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.status
}

// crashed remembers that the program died on this CPU.
func (p *WhisperPicker) crashed() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.status.Runs, p.status.Problem = false, whisperCrashed
}

// probeWhisper starts whisper with an empty model and a file that exists. A
// program that works exits at once with an error about the model: that is
// fine, only a crash matters.
func probeWhisper(ctx context.Context, program string) error {
	return exec.CommandContext(ctx, program, "-m", os.DevNull, "-f", program).Run()
}

// isIllegalInstruction reports whether a program died on an instruction this
// CPU does not have: SIGILL, or the same thing as Windows says it.
func isIllegalInstruction(err error) bool {
	var exit *exec.ExitError
	if !errors.As(err, &exit) {
		return false
	}
	const windowsIllegalInstruction = 0xC000001D
	return strings.Contains(exit.ProcessState.String(), "illegal instruction") ||
		uint32(exit.ExitCode()) == windowsIllegalInstruction
}

// whisperCannotRun is a whisper that cannot work on this CPU. Trying again
// cannot help, and the administrator reads its words as they are.
type whisperCannotRun struct{ words string }

func (e whisperCannotRun) Error() string { return e.words }

func (e whisperCannotRun) Is(target error) bool { return target == jobs.ErrPermanent }

// UseWhisper makes the transcriber run the program p chose, and not even try
// when it knows the program cannot work here.
func (t *Transcriber) UseWhisper(p *WhisperPicker) {
	t.whisper = p.Program()
	t.picker = p
}

// whisperProblem says why whisper cannot work, before any other work is done.
func (t *Transcriber) whisperProblem(ctx context.Context) error {
	if t.picker == nil {
		return nil
	}
	if words := t.picker.Status(ctx).Problem; words != "" {
		return whisperCannotRun{words}
	}
	return nil
}

// whisperFailed is the error for whisper's failure on a video. A crash on an
// instruction the CPU lacks is forever, and is said in plain words.
func (t *Transcriber) whisperFailed(videoID int64, err error) error {
	if !isIllegalInstruction(err) {
		return fmt.Errorf("whisper on video %d: %w", videoID, err)
	}
	if t.picker != nil {
		t.picker.crashed()
	}
	return whisperCannotRun{whisperCrashed}
}
