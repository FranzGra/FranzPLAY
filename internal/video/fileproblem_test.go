package video

import "testing"

func TestFileProblemTellsTheKindAndKeepsTheToolsWords(t *testing.T) {
	for _, tt := range []struct {
		name   string
		err    string
		kind   FileProblemKind
		detail string
	}{
		{
			"file cut short",
			"read video 7: ffprobe: exit status 1: [mov @ 0x1] moov atom not found",
			FileDamaged, "exit status 1: [mov @ 0x1] moov atom not found",
		},
		{
			"file that is not a video at all",
			"read video 7: ffprobe: exit status 1: /videos/a.mp4: Invalid data found when processing input",
			FileDamaged, "exit status 1: /videos/a.mp4: Invalid data found when processing input",
		},
		{"no pictures in it", "video 7: " + ErrNotVideo.Error() + ": permanent", FileNoVideo, ErrNotVideo.Error() + ": permanent"},
		{"anything else", "read video 7: ffprobe: exit status 1: Permission denied", FileUnreadable, "exit status 1: Permission denied"},
		{"no words at all", "", FileUnreadable, ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			kind, detail := FileProblem(tt.err)
			if kind != tt.kind || detail != tt.detail {
				t.Errorf("got %q, %q; want %q, %q", kind, detail, tt.kind, tt.detail)
			}
		})
	}
}
