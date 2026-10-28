package media

import (
	"os"
	"testing"
)

// Most tests name videos that are not on disk (/videos/a.mp4) and fake
// ffmpeg: for them every file is there. TestMissingFileWaits checks the
// real fileThere.
func TestMain(m *testing.M) {
	fileThere = func(string) error { return nil }
	os.Exit(m.Run())
}
