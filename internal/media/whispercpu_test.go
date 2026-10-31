package media

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
)

func TestCPUFlags(t *testing.T) {
	x86 := "processor\t: 0\nmodel name\t: Some CPU\nflags\t\t: fpu sse4_2 avx\nbugs\t\t: none\n"
	if got := cpuFlags(x86); strings.Join(got, " ") != "fpu sse4_2 avx" {
		t.Errorf("x86 flags = %v", got)
	}
	if got := cpuFlags("processor\t: 0\nFeatures\t: fp asimd\n"); got != nil {
		t.Errorf("arm flags = %v, want not known", got)
	}
	if got := cpuFlags(""); got != nil {
		t.Errorf("no file: flags = %v, want not known", got)
	}
}

func TestWhisperPickerChoosesForTheCPU(t *testing.T) {
	modern := []string{"sse4_2", "avx", "avx2", "fma", "f16c", "bmi2"}
	small := []string{"sse4_2", "ssse3"}
	noAVX2 := []string{"sse4_2", "avx", "f16c"} // like an Ivy Bridge
	tests := []struct {
		name     string
		flags    []string
		hasBasic bool
		program  string
		build    string
		slow     bool
		problem  bool
	}{
		{"modern CPU", modern, true, "w", WhisperComplete, false, false},
		{"small CPU", small, true, "w-basic", WhisperBasic, true, false},
		{"AVX without AVX2", noAVX2, true, "w-basic", WhisperBasic, true, false},
		{"too old even for the basic one", []string{"sse2"}, true, "w", "", true, true},
		{"not x86: one program", nil, false, "w", "", false, false},
		{"flags not known, basic there", nil, true, "w", "", false, false},
		{"installed by hand, modern", modern, false, "w", "", false, false},
		{"installed by hand, small", small, false, "w", "", true, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := newWhisperPicker("w", tt.flags, tt.hasBasic)
			p.probe = func(context.Context, string) error { return nil }
			s := p.Status(context.Background())
			if p.Program() != tt.program || s.Build != tt.build || s.SlowCPU != tt.slow {
				t.Errorf("program %q, %+v", p.Program(), s)
			}
			if s.Runs == tt.problem || (s.Problem != "") != tt.problem {
				t.Errorf("runs and problem: %+v, want problem %v", s, tt.problem)
			}
		})
	}
}

// script writes a real program, in a folder of its own.
func script(t *testing.T, body string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("needs a shell script and signals")
	}
	path := filepath.Join(t.TempDir(), "whisper-cli")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+body+"\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}

// crashing dies as whisper does on a CPU without the right instructions.
const crashing = "kill -ILL $$"

func TestWhisperPickerProbesOnceAndSeesACrash(t *testing.T) {
	p := newWhisperPicker(script(t, crashing), nil, false)
	s := p.Status(context.Background())
	if s.Runs || s.Problem != whisperCrashed {
		t.Fatalf("status = %+v", s)
	}
	calls := 0
	p.probe = func(context.Context, string) error { calls++; return nil }
	if s := p.Status(context.Background()); s.Runs || calls != 0 {
		t.Errorf("second status = %+v after %d more checks", s, calls)
	}
}

func TestWhisperPickerAcceptsAProgramThatComplains(t *testing.T) {
	path := script(t, "echo bad magic >&2\nexit 3")
	s := newWhisperPicker(path, nil, false).Status(context.Background())
	if !s.Runs || s.Problem != "" {
		t.Errorf("status = %+v", s)
	}
}

func TestIsIllegalInstruction(t *testing.T) {
	if isIllegalInstruction(errors.New("illegal instruction")) {
		t.Error("words alone are not a crash")
	}
	if isIllegalInstruction(nil) {
		t.Error("no error is not a crash")
	}
	program := script(t, crashing)
	if !isIllegalInstruction(probeWhisper(context.Background(), program)) {
		t.Error("real crash not seen")
	}
	stream := streamInBackground(context.Background(), program, func(string) {})
	if !isIllegalInstruction(stream) {
		t.Errorf("crash not seen through a stream's error: %v", stream)
	}
}

func TestCrashIsPermanentAndSaidInItalian(t *testing.T) {
	tr := &Transcriber{}
	crash := streamInBackground(context.Background(), script(t, crashing), func(string) {})
	err := tr.whisperFailed(3, crash)
	if !errors.Is(err, jobs.ErrPermanent) {
		t.Errorf("error %v is not permanent", err)
	}
	if err.Error() != whisperCrashed {
		t.Errorf("error = %q", err)
	}
	if other := tr.whisperFailed(3, errors.New("no memory")); errors.Is(other, jobs.ErrPermanent) {
		t.Errorf("error %v should be tried again", other)
	}
}

func TestTranscriberStopsAtOnceWhenWhisperCannotRun(t *testing.T) {
	tr := &Transcriber{}
	if err := tr.whisperProblem(context.Background()); err != nil {
		t.Errorf("no picker: %v", err)
	}
	tr.UseWhisper(newWhisperPicker("w", []string{"sse2"}, true))
	if err := tr.whisperProblem(context.Background()); !errors.Is(err, jobs.ErrPermanent) || err.Error() != whisperOldCPU {
		t.Errorf("too old a CPU: %v", err)
	}
}
