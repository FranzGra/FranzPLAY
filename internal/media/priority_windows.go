package media

import (
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

// startInBackground starts cmd with a processor priority below the normal
// one, so FranzPLAY itself always comes first.
func startInBackground(cmd *exec.Cmd) error {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.BELOW_NORMAL_PRIORITY_CLASS}
	return cmd.Start()
}
