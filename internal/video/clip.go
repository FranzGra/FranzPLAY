package video

import "strconv"

// A clip is the few silent seconds that play on a video's card while the
// pointer rests on it, or a finger presses it on a phone. It is made of
// short parts taken from different moments, so it gives an idea of the
// whole video, and it is small: ClipHeight pixels high, a few hundred KB.
// Each clip is also made sharper, ClipHDHeight pixels high, for browsers
// on a good connection.
const (
	ClipHeight      = 360 // pixels: light to download, fine on a slow connection
	ClipHDHeight    = 720 // pixels: sharp on any card, even on a sharp screen
	clipParts       = 3   // moments shown in a long video
	clipPartSeconds = 2   // seconds of each moment
	minClipVideo    = 4   // seconds: shorter videos get no clip
	shortClipVideo  = 30  // seconds: shorter videos get a single part
)

// How long a clip lasts, in seconds: the administrator chooses it for the
// whole site, and for one video if they like. DefaultClipSeconds is the
// clip FranzPLAY always made: clipParts moments of clipPartSeconds.
const (
	DefaultClipSeconds = clipParts * clipPartSeconds
	MinClipSeconds     = 2
	MaxClipSeconds     = 30
)

// MaxClipStartPercent is the latest place, in percent of the video, the
// administrator may choose as the start of every clip: a clip starting
// later would have little left to show.
const MaxClipStartPercent = 95

// ClipPlan is where a clip starts and how long it lasts.
//
//   - Second >= 0: from that second of the video (the administrator chose it
//     for this video, with the slider).
//   - otherwise Percent > 0: from that point of the video, in percent of its
//     length (the administrator chose it for the whole site).
//   - otherwise automatic, as FranzPLAY always did: clipParts moments
//     spread over the video.
//
// Seconds is the length of the whole clip; 0 means DefaultClipSeconds.
type ClipPlan struct {
	Second  int64
	Percent int
	Seconds int64
}

// AutoClip is the plan of a video with no choice at all.
var AutoClip = ClipPlan{Second: -1}

// Tag is a short name of the plan, "" for the clip FranzPLAY always made:
// in the address of a clip, so a browser never shows the one made before.
func (p ClipPlan) Tag() string {
	n := p.seconds()
	switch {
	case p.Second >= 0:
		return "s" + strconv.FormatInt(p.Second, 10) + "-" + strconv.FormatInt(n, 10)
	case p.Percent > 0:
		return "p" + strconv.Itoa(p.Percent) + "-" + strconv.FormatInt(n, 10)
	case n != DefaultClipSeconds:
		return "a" + strconv.FormatInt(n, 10)
	}
	return ""
}

// seconds is the length asked, kept between MinClipSeconds and MaxClipSeconds.
func (p ClipPlan) seconds() int64 {
	if p.Seconds <= 0 {
		return DefaultClipSeconds
	}
	return min(max(p.Seconds, MinClipSeconds), MaxClipSeconds)
}

// ClipPart is one piece of a clip: Length seconds from Start.
type ClipPart struct {
	Start  int64 // seconds from the beginning of the video
	Length int64 // seconds
}

// ClipParts decides which pieces of a video that lasts duration seconds
// make its clip. A long video shows clipParts moments spread over it (at
// one quarter, half and three quarters), so openings and end titles are
// skipped. A short one shows its first seconds, after a tenth to skip a
// black start. A very short video, or one of unknown length, gets none.
func ClipParts(duration int64) []ClipPart {
	return AutoClip.Parts(duration)
}

// Parts decides which pieces of a video that lasts duration seconds make
// the clip of plan p. A chosen start gives one piece from there; if the
// video ends first, the piece starts earlier, and a video shorter than
// the clip gives all of itself. The automatic plan is ClipParts', with
// its seconds shared among the moments. A very short video, or one of
// unknown length, gets none.
func (p ClipPlan) Parts(duration int64) []ClipPart {
	if duration < minClipVideo {
		return nil
	}
	length := p.seconds()
	if p.Second >= 0 || p.Percent > 0 {
		start := p.Second
		if start < 0 {
			start = duration * int64(min(p.Percent, MaxClipStartPercent)) / 100
		}
		length = min(length, duration)
		return []ClipPart{{Start: min(start, duration-length), Length: length}}
	}
	if duration < shortClipVideo {
		start := duration / 10
		return []ClipPart{{Start: start, Length: min(length, duration-start)}}
	}
	// The seconds shared among the moments, the first ones a second longer
	// when they do not divide evenly.
	n := min(int64(clipParts), length)
	parts := make([]ClipPart, n)
	for i := range parts {
		l := length / n
		if int64(i) < length%n {
			l++
		}
		start := duration * int64(i+1) / (n + 1)
		parts[i] = ClipPart{Start: min(start, duration-l), Length: l}
	}
	return parts
}
