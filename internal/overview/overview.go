// Package overview makes the administrator's summary: how much space is
// left on the disks, how many videos, people and comments there are, and
// a short list of what needs attention. It only reads.
package overview

import (
	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// Videos are the numbers about the videos.
type Videos struct {
	Present  int `json:"present"`  // in the folders now, hidden ones too
	Eligible int `json:"eligible"` // of those, long enough and readable
	Short    int `json:"short"`    // of those, below the minimum length
	Problems int `json:"problems"` // of those, damaged or not a video
	Hidden   int `json:"hidden"`   // hidden by the administrator
	Missing  int `json:"missing"`  // no longer found in the folders
	Analysed int `json:"analysed"` // FranzPLAY read their length and format
	Playable int `json:"playable"` // play in every browser, as they are or with a copy
	NoCover  int `json:"noCover"`  // analysed, but still without a cover
}

// Jobs are the numbers about the queue of heavy work.
type Jobs struct {
	Waiting int `json:"waiting"` // waiting or running
	Failed  int `json:"failed"`
}

// Disk is the space on the disk that holds one folder.
type Disk struct {
	Folder  string `json:"folder"`  // the folder, as set in the settings
	Data    bool   `json:"data"`    // it is FranzPLAY's data or content folder, not a video folder
	Content bool   `json:"content"` // it is the content folder, when that is not the data folder
	Total   uint64 `json:"total"`   // bytes; 0 if it could not be read
	Free    uint64 `json:"free"`    // bytes
	Error   bool   `json:"error"`   // the folder could not be read: not there, or not mounted
}

// DamagedFile is a file in the video folders FranzPLAY cannot read.
type DamagedFile struct {
	ID     int64                 `json:"id"`
	Title  string                `json:"title"`
	Path   string                `json:"path"` // the whole path, as FranzPLAY sees it
	Size   int64                 `json:"size"` // bytes
	Kind   video.FileProblemKind `json:"kind"`
	Detail string                `json:"detail"` // the error of the tool
}

// Overview is everything the summary shows.
type Overview struct {
	Version    string    `json:"version"`
	Videos     Videos    `json:"videos"`
	Categories int       `json:"categories"`
	People     int       `json:"people"`
	Admins     int       `json:"admins"`
	Comments   int       `json:"comments"`
	Jobs       Jobs      `json:"jobs"`
	Disks      []Disk    `json:"disks"`
	Problems   []Problem `json:"problems"`
	// Damaged are the first files of Videos.Problems, at most maxDamaged.
	Damaged []DamagedFile `json:"damaged"`
	// Leftovers are the first folders of contents with no video, at most
	// maxLeftovers, out of LeftoversTotal. Nothing deletes them by itself.
	Leftovers      []content.Leftover `json:"leftovers"`
	LeftoversTotal int                `json:"leftoversTotal"`
	// InContainer says the paths are the ones seen inside a container, not
	// the ones of the computer that runs it.
	InContainer bool `json:"inContainer"`
}

// maxDamaged is how many damaged files the summary lists: enough to work
// through, and the page stays light even with a disk gone bad.
const maxDamaged = 200

// maxLeftovers is how many folders with no video the summary lists.
const maxLeftovers = 200

// ProblemKind names something that needs attention. The list is closed:
// the interface has a sentence and a link for each.
type ProblemKind string

// The problems.
const (
	DiskFull      ProblemKind = "disk_full"      // less than 10% free
	DiskLow       ProblemKind = "disk_low"       // less than 25% free
	DiskUnread    ProblemKind = "disk_unread"    // a folder could not be read
	FailedJobs    ProblemKind = "failed_jobs"    // some work did not succeed
	MissingVideos ProblemKind = "missing_videos" // videos not found any more
	NoCovers      ProblemKind = "no_covers"      // analysed videos still without a cover
	NoFFmpeg      ProblemKind = "no_ffmpeg"      // ffmpeg or ffprobe is not installed
)

// Severity says how urgent a problem is.
type Severity string

// The severities.
const (
	Warning  Severity = "warning"
	Critical Severity = "critical"
)

// Problem is one thing that needs attention.
type Problem struct {
	Kind     ProblemKind `json:"kind"`
	Severity Severity    `json:"severity"`
	Count    int         `json:"count,omitempty"`  // how many videos or jobs
	Folder   string      `json:"folder,omitempty"` // for problems of a disk
}

// Thresholds of free space, as in the old FranzPLAY: 75% used is a
// warning, 90% is critical.
const (
	lowFree  = 0.25
	fullFree = 0.10
)

// findProblems decides what needs attention. Pure: easy to test. tools
// says whether ffmpeg and ffprobe were found.
func findProblems(o Overview, tools bool) []Problem {
	out := []Problem{}
	if !tools {
		out = append(out, Problem{Kind: NoFFmpeg, Severity: Critical})
	}
	for _, d := range o.Disks {
		switch {
		case d.Error:
			out = append(out, Problem{Kind: DiskUnread, Severity: Critical, Folder: d.Folder})
		case d.Total == 0:
		case float64(d.Free) < fullFree*float64(d.Total):
			out = append(out, Problem{Kind: DiskFull, Severity: Critical, Folder: d.Folder})
		case float64(d.Free) < lowFree*float64(d.Total):
			out = append(out, Problem{Kind: DiskLow, Severity: Warning, Folder: d.Folder})
		}
	}
	if o.Jobs.Failed > 0 {
		out = append(out, Problem{Kind: FailedJobs, Severity: Warning, Count: o.Jobs.Failed})
	}
	if o.Videos.Missing > 0 {
		out = append(out, Problem{Kind: MissingVideos, Severity: Warning, Count: o.Videos.Missing})
	}
	// Without ffmpeg no video gets a cover: that is already said above.
	if tools && o.Videos.NoCover > 0 && o.Jobs.Waiting == 0 {
		out = append(out, Problem{Kind: NoCovers, Severity: Warning, Count: o.Videos.NoCover})
	}
	return out
}
