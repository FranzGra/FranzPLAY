//go:build !linux && !windows

package media

import "os/exec"

// startInBackground starts cmd normally: on these systems the priority
// belongs to the whole of FranzPLAY, and lowering it for one program is
// not as simple. Linux, where FranzPLAY usually runs, does lower it.
func startInBackground(cmd *exec.Cmd) error {
	return cmd.Start()
}
