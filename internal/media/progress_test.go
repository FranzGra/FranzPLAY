package media

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
)

// whisperPrints is what whisper.cpp 1.9.5 printed with -np -pp on 70
// seconds of speech, both outputs mixed as they arrive.
var whisperPrints = []string{
	"read_audio_data: reading audio data from '/tmp/s.wav' ...",
	"",
	"[00:00:00.000 --> 00:00:06.240]   Parti numero uno, un giorno a tutti.",
	"[00:00:06.240 --> 00:00:13.680]   programma soltanto è scrive i sottotitoli.",
	"whisper_print_progress_callback: progress =  38%",
	"[00:00:13.680 --> 00:00:20.320]   Domani più vera al nord, ci sarà il sole al sud.",
	"[00:00:20.320 --> 00:00:27.280]   Questo è un video di prova.",
	"whisper_print_progress_callback: progress =  73%",
	"[00:01:01.280 --> 00:01:08.480]   O di parliamo del tempo.",
	"[00:00:05.000 --> 00:00:07.000]   going back never lowers it",
	"whisper_print_progress_callback: progress = 100%",
	"output_json: saving output to '/tmp/h.json'",
}

func TestWhisperProgress(t *testing.T) {
	w := whisperProgress{total: 70, percent: -1}
	var percents []int
	for _, line := range whisperPrints {
		if w.read(line) {
			percents = append(percents, int(w.progress().Percent))
		}
	}
	// 6.24/70 = 8%, 13.68/70 = 19%, then whisper's 38%, 20.32 s = 29% is
	// below it…
	want := []int{8, 19, 38, 38, 38, 73, 97, 100}
	if !slices.Equal(percents, want) {
		t.Errorf("progress %v, want %v", percents, want)
	}
	if p := w.progress(); p.Done != 68.48 || p.Total != 70 || p.Stage != "transcribe" {
		t.Errorf("at the end %+v, want 68.48 of 70 seconds heard", p)
	}
}

func TestWhisperProgressWithoutLength(t *testing.T) {
	w := whisperProgress{percent: -1}
	if w.read("[00:00:00.000 --> 00:00:06.240]   x") && w.progress().Percent != -1 {
		t.Errorf("without the length a sentence makes %v%%, want not known", w.progress().Percent)
	}
	w.read("whisper_print_progress_callback: progress =  5%")
	if p := w.progress(); p.Percent != 5 || p.Done != 6.24 {
		t.Errorf("progress %+v, want whisper's 5%%", p)
	}
}

func TestClockSeconds(t *testing.T) {
	for in, want := range map[string]float64{"00:00:06.240": 6.24, "01:02:03.500": 3723.5, "10:00:00.000": 36000} {
		if got, ok := clockSeconds(in); !ok || got != want {
			t.Errorf("clockSeconds(%q) = %v, %v; want %v", in, got, ok, want)
		}
	}
	for _, in := range []string{"", "6.24", "00:61:00.000", "aa:00:00.000"} {
		if _, ok := clockSeconds(in); ok {
			t.Errorf("clockSeconds(%q) accepted", in)
		}
	}
}

// TestTranscribeReportsProgress: while whisper prints, the job tells the
// queue the stage and how much of the sound it has heard.
func TestTranscribeReportsProgress(t *testing.T) {
	fx := newTranscribeFixture(t)
	fx.ask(t, "it", "small", "")
	fx.printed = whisperPrints
	// The sound the fake ffmpeg writes lasts 70 seconds.
	run := fx.tr.run
	fx.tr.run = func(ctx context.Context, program string, args ...string) ([]byte, error) {
		out, err := run(ctx, program, args...)
		if program == "ffmpeg" && err == nil {
			err = os.WriteFile(strings.TrimPrefix(args[len(args)-1], "file:"), make([]byte, 44+70*32000), 0o600)
		}
		return out, err
	}
	var got []jobs.Progress
	ctx := jobs.WithReporter(context.Background(), func(p jobs.Progress) { got = append(got, p) })
	if err := fx.tr.Handle(ctx, fx.id); err != nil {
		t.Fatal(err)
	}
	var stages []string
	last := -2.0
	for _, p := range got {
		if len(stages) == 0 || stages[len(stages)-1] != p.Stage {
			stages = append(stages, p.Stage)
		}
		if p.Stage == "transcribe" && p.Percent >= 0 { // -1: the stage begins, nothing known yet
			if p.Percent < last || p.Total != 70 {
				t.Errorf("progress %+v after %v%%: want growing, of 70 seconds", p, last)
			}
			last = p.Percent
		}
	}
	if !slices.Equal(stages, []string{"audio", "transcribe", ""}) {
		t.Errorf("stages %q", stages)
	}
	if last != 100 {
		t.Errorf("last progress %v%%, want 100", last)
	}
}

// TestStreamInBackground runs a real program: its lines arrive one by
// one, from both outputs, and a failure carries the error output.
func TestStreamInBackground(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("needs sh")
	}
	sh, err := exec.LookPath("sh")
	if err != nil {
		t.Skip("no sh")
	}
	var lines []string
	err = streamInBackground(context.Background(), sh, func(l string) { lines = append(lines, l) },
		"-c", "echo uno; echo due >&2; echo tre; echo 'perché no' >&2; exit 3")
	if err == nil || !strings.Contains(err.Error(), "perché no") || strings.Contains(err.Error(), "tre") {
		t.Errorf("error %v, want the exit status with the error output only", err)
	}
	slices.Sort(lines) // the two outputs may come in any order
	if want := []string{"due", "perché no", "tre", "uno"}; !slices.Equal(lines, want) {
		t.Errorf("lines %q, want %q", lines, want)
	}
	lines = nil
	long := filepath.Join(t.TempDir(), "long")
	if err := os.WriteFile(long, []byte(strings.Repeat("x", maxStreamLine+10)+"\nend\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	// A line too long is not read, but the program is not stuck.
	if err := streamInBackground(context.Background(), sh, func(l string) { lines = append(lines, l) },
		"-c", "cat "+long); err != nil {
		t.Fatal(err)
	}
}
