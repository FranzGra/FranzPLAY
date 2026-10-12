package media

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// The job queue's programs get the lowest priority for the processor and
// the disk, and FranzPLAY's own threads keep theirs: a video someone is
// watching must never wait for a cover being made.
func TestStartInBackgroundLowersOnlyTheProgram(t *testing.T) {
	sleep, err := exec.LookPath("sleep")
	if err != nil {
		t.Skip("no sleep program:", err)
	}
	cmd := exec.Command(sleep, "10")
	if err := startInBackground(cmd); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	})
	pid := cmd.Process.Pid

	// The kernel answers 20 minus the nice value: 1 is nice 19.
	prio, err := unix.Getpriority(unix.PRIO_PROCESS, pid)
	if err != nil {
		t.Fatal(err)
	}
	if prio != 20-lowestNice {
		t.Errorf("program nice = %d, want %d", 20-prio, lowestNice)
	}
	io, _, errno := unix.Syscall(unix.SYS_IOPRIO_GET, ioprioWhoProcess, uintptr(pid), 0)
	if errno != 0 {
		t.Fatal(errno)
	}
	if class := io >> ioprioClassShift; class != ioprioClassIdle {
		t.Errorf("program disk priority class = %d, want %d (idle)", class, ioprioClassIdle)
	}

	// No thread of FranzPLAY itself stays lowered: the one that started
	// the program goes away soon after.
	deadline := time.Now().Add(5 * time.Second)
	for {
		lowered := loweredThreads(t)
		if len(lowered) == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("threads of FranzPLAY still lowered: %v", lowered)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// loweredThreads lists the threads of this program whose nice is not 0.
// The first thread, whose id is the program's, is left out: if it started
// a program, Go parks it for good, and it runs nothing else.
func loweredThreads(t *testing.T) []string {
	t.Helper()
	stats, err := filepath.Glob("/proc/self/task/*/stat")
	if err != nil {
		t.Fatal(err)
	}
	first := fmt.Sprintf("/proc/self/task/%d/stat", os.Getpid())
	var lowered []string
	for _, f := range stats {
		if f == first {
			continue
		}
		data, err := os.ReadFile(f)
		if err != nil {
			continue // the thread ended meanwhile
		}
		// After the name in brackets, nice is the 17th field.
		fields := strings.Fields(string(data[bytes.LastIndexByte(data, ')')+1:]))
		if fields[16] != "0" {
			lowered = append(lowered, f)
		}
	}
	return lowered
}

func TestRunInBackgroundReturnsOutputAndErrors(t *testing.T) {
	sh, err := exec.LookPath("sh")
	if err != nil {
		t.Skip("no sh program:", err)
	}
	out, err := runInBackground(context.Background(), sh, "-c", "echo hello")
	if err != nil || strings.TrimSpace(string(out)) != "hello" {
		t.Errorf("output = %q, %v; want hello", out, err)
	}
	_, err = runInBackground(context.Background(), sh, "-c", "echo broken >&2; exit 3")
	if err == nil || !strings.Contains(err.Error(), "broken") {
		t.Errorf("error = %v, want it to carry what the program printed", err)
	}
}
