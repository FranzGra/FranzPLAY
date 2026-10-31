package video

import (
	"regexp"
	"strings"
)

// FileProblemKind says, in one word, why a file in the video folders cannot
// be read. The list is closed: the interface has a sentence for each.
type FileProblemKind string

// The problems of a file.
const (
	FileDamaged    FileProblemKind = "damaged"    // the tool found it broken or cut short
	FileNoVideo    FileProblemKind = "no_video"   // it can be read, but there are no pictures in it
	FileUnreadable FileProblemKind = "unreadable" // it could not be read, for another reason
)

// damagedSigns are the words ffprobe uses for a file that is broken or cut
// short, rather than for a file it was not able to reach.
var damagedSigns = []string{
	"moov atom not found",
	"invalid data found",
	"invalid argument",
	"end of file",
	"partial file",
	"truncat",
	"ebml header parsing failed",
	"could not find codec parameters",
}

// jobPrefix is what FranzPLAY adds before the words of the tool.
var jobPrefix = regexp.MustCompile(`^(read )?video \d+: (ffprobe: )?`)

// FileProblem reads the error left by the failed reading of a file: what kind
// of problem it is, and the technical words without FranzPLAY's own prefix.
func FileProblem(readError string) (FileProblemKind, string) {
	detail := jobPrefix.ReplaceAllString(strings.TrimSpace(readError), "")
	lower := strings.ToLower(detail)
	if strings.Contains(lower, strings.ToLower(ErrNotVideo.Error())) {
		return FileNoVideo, detail
	}
	for _, sign := range damagedSigns {
		if strings.Contains(lower, sign) {
			return FileDamaged, detail
		}
	}
	return FileUnreadable, detail
}
