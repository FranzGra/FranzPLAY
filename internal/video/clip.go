package video

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
	if duration < minClipVideo {
		return nil
	}
	length := int64(clipParts * clipPartSeconds)
	if duration < shortClipVideo {
		start := duration / 10
		return []ClipPart{{Start: start, Length: min(length, duration-start)}}
	}
	parts := make([]ClipPart, clipParts)
	for i := range parts {
		parts[i] = ClipPart{Start: duration * int64(i+1) / (clipParts + 1), Length: clipPartSeconds}
	}
	return parts
}
