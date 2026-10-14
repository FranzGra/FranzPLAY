package media

import (
	"fmt"
	"os/exec"
	"runtime"

	"golang.org/x/sys/unix"
)

// lowestNice is the lowest processor priority on Linux.
const lowestNice = 19

// I/O priority classes, from the Linux ioprio_set manual: idle means the
// program reads and writes the disk only when nobody else needs it.
const (
	ioprioWhoProcess = 1
	ioprioClassIdle  = 3
	ioprioClassShift = 13
)

// startInBackground starts cmd with the lowest priority for the processor
// and the disk.
//
// On Linux these priorities belong to each thread, and a new program
// inherits them from the thread that starts it. So the program is started
// from a thread of its own, lowered first: FranzPLAY's other threads keep
// their normal priority. The thread is locked and never unlocked, so when
// the goroutine ends Go throws the thread away (the program's first thread,
// which cannot end, is parked for good instead): no other work ever runs
// on it.
func startInBackground(cmd *exec.Cmd) error {
	done := make(chan error, 1)
	go func() {
		runtime.LockOSThread()
		if err := unix.Setpriority(unix.PRIO_PROCESS, 0, lowestNice); err != nil {
			done <- fmt.Errorf("lower processor priority: %w", err)
			return
		}
		if _, _, errno := unix.Syscall(unix.SYS_IOPRIO_SET, ioprioWhoProcess, 0,
			ioprioClassIdle<<ioprioClassShift); errno != 0 {
			done <- fmt.Errorf("lower disk priority: %w", errno)
			return
		}
		done <- cmd.Start()
	}()
	return <-done
}
