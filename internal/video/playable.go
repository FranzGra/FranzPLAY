package video

import "strings"

// Browsers can play some kinds of video file directly, without FranzPLAY
// converting them. These lists hold what Chrome, Firefox and Safari all
// play. Anything else may still play in some browsers, but not everywhere:
// converting those files is planned for later (stage 3).
var (
	playableExtensions  = map[string]bool{".mp4": true, ".m4v": true, ".mov": true, ".webm": true}
	playableVideoCodecs = map[string]bool{"h264": true, "vp8": true, "vp9": true, "av1": true}
	playableAudioCodecs = map[string]bool{"": true, "aac": true, "mp3": true, "opus": true, "vorbis": true, "flac": true}
)

// DirectlyPlayable reports whether every common browser can play the file
// as it is. ext is the file extension, like ".mp4".
func DirectlyPlayable(ext string, info Info) bool {
	return playableExtensions[strings.ToLower(ext)] &&
		playableVideoCodecs[info.VideoCodec] &&
		playableAudioCodecs[info.AudioCodec]
}
