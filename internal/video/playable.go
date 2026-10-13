package video

import "strings"

// Browsers can play some kinds of video file directly, without FranzPLAY
// converting them. These lists hold only what every common browser plays:
// Chrome, Edge and Firefox, and Safari on iPhone, iPad and Mac too, old
// ones included. Anything else may still play in some browsers, but not
// everywhere: for those FranzPLAY makes a copy (see PlanConversion).
//
// Apple is what makes the lists short. Safari opens no .mkv, .webm only
// on recent systems, VP9 and AV1 only on some devices, and Opus or Vorbis
// sound only on recent systems or never.
var (
	playableExtensions  = map[string]bool{".mp4": true, ".m4v": true, ".mov": true}
	playableVideoCodecs = map[string]bool{"h264": true}
	playableAudioCodecs = map[string]bool{"": true, "aac": true, "mp3": true}
)

// plainPixelFormats are the H.264 pictures every device decodes: 8 bits
// per colour, with colour kept for every other dot (4:2:0), in TV or full
// range. "" is a picture not read yet: almost every H.264 is like this.
// A 10-bit ("High 10") or 4:4:4 H.264 plays almost nowhere.
var plainPixelFormats = map[string]bool{"": true, "yuv420p": true, "yuvj420p": true}

// DirectlyPlayable reports whether every common browser can play the file
// as it is. ext is the file extension, like ".mp4".
func DirectlyPlayable(ext string, info Info) bool {
	return playableExtensions[strings.ToLower(ext)] &&
		plainPicture(info) &&
		playableAudioCodecs[info.AudioCodec]
}

// plainPicture reports whether every device decodes the picture.
func plainPicture(info Info) bool {
	return playableVideoCodecs[info.VideoCodec] && plainPixelFormats[info.PixelFormat]
}

// mp4AudioCodecs are the sounds every browser plays inside an MP4 file.
var mp4AudioCodecs = map[string]bool{"aac": true, "mp3": true}

// CopyAudioToMP4 reports whether a sound track can go as it is into the
// MP4 a browser plays; if not (like the AC3 or DTS of many films, or the
// Opus of many web videos), it must be converted, which costs a little
// work.
func CopyAudioToMP4(codec string) bool {
	return mp4AudioCodecs[codec]
}
