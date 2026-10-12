package overview

import (
	"reflect"
	"testing"
)

func TestFindProblems(t *testing.T) {
	const gb = 1 << 30
	tests := []struct {
		name  string
		o     Overview
		tools bool
		want  []Problem
	}{
		{"all good", Overview{Disks: []Disk{{Folder: "/dati", Total: 100 * gb, Free: 50 * gb}}}, true, []Problem{}},
		{"no ffmpeg", Overview{}, false, []Problem{{Kind: NoFFmpeg, Severity: Critical}}},
		{"disk 80% used", Overview{Disks: []Disk{{Folder: "/video", Total: 100 * gb, Free: 20 * gb}}}, true,
			[]Problem{{Kind: DiskLow, Severity: Warning, Folder: "/video"}}},
		{"disk 95% used", Overview{Disks: []Disk{{Folder: "/video", Total: 100 * gb, Free: 5 * gb}}}, true,
			[]Problem{{Kind: DiskFull, Severity: Critical, Folder: "/video"}}},
		{"exactly 75% used is fine", Overview{Disks: []Disk{{Folder: "/video", Total: 100 * gb, Free: 25 * gb}}}, true,
			[]Problem{}},
		{"folder not readable", Overview{Disks: []Disk{{Folder: "/mnt/usb", Error: true}}}, true,
			[]Problem{{Kind: DiskUnread, Severity: Critical, Folder: "/mnt/usb"}}},
		{"failed jobs and missing videos", Overview{Jobs: Jobs{Failed: 2}, Videos: Videos{Missing: 3}}, true,
			[]Problem{{Kind: FailedJobs, Severity: Warning, Count: 2}, {Kind: MissingVideos, Severity: Warning, Count: 3}}},
		{"no cover once the work is over", Overview{Videos: Videos{NoCover: 4}}, true,
			[]Problem{{Kind: NoCovers, Severity: Warning, Count: 4}}},
		{"no cover while work is waiting: not yet a problem", Overview{Videos: Videos{NoCover: 4}, Jobs: Jobs{Waiting: 1}}, true,
			[]Problem{}},
		{"no cover without ffmpeg: said once", Overview{Videos: Videos{NoCover: 4}}, false,
			[]Problem{{Kind: NoFFmpeg, Severity: Critical}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := findProblems(tt.o, tt.tools); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("findProblems = %+v, want %+v", got, tt.want)
			}
		})
	}
}
