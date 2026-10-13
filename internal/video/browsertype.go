package video

import "strings"

// BrowserType describes a video file the way a browser is asked whether
// it can play it (HTMLMediaElement.canPlayType), like
// `video/webm; codecs="vp09.00.40.08, opus"`. ext is the file extension.
// It is "" when no browser is worth asking: a box only some browsers open
// (.mkv, .avi…), or a format with no well-known name.
//
// A browser that answers "yes" plays the file itself, at its full
// quality; every other one gets the copy made for every device.
func BrowserType(ext string, info Info) string {
	ten := strings.Contains(info.PixelFormat, "10")
	var box, picture string
	switch strings.ToLower(ext) {
	case ".mp4", ".m4v", ".mov":
		box = "video/mp4"
	case ".webm":
		box = "video/webm"
	default:
		return ""
	}
	switch info.VideoCodec {
	case "h264":
		picture = h264Type(info.PixelFormat)
	case "hevc":
		picture = map[bool]string{false: "hvc1.1.6.L120.90", true: "hvc1.2.4.L120.90"}[ten]
	case "vp9":
		picture = map[bool]string{false: "vp09.00.40.08", true: "vp09.02.40.10"}[ten]
	case "av1":
		picture = map[bool]string{false: "av01.0.08M.08", true: "av01.0.08M.10"}[ten]
	case "vp8":
		picture = "vp8"
	}
	sound, known := soundTypes[info.AudioCodec]
	if picture == "" || !known {
		return ""
	}
	if box == "video/webm" && (strings.HasPrefix(picture, "avc1") || strings.HasPrefix(picture, "hvc1")) {
		return "" // not in a .webm
	}
	if sound == "" {
		return box + `; codecs="` + picture + `"`
	}
	return box + `; codecs="` + picture + ", " + sound + `"`
}

// h264Type names an H.264 picture by the profile its pixels need: High
// for the plain 8-bit one, High 10, 4:2:2 or 4:4:4 for the others.
func h264Type(pixels string) string {
	switch {
	case plainPixelFormats[pixels]:
		return "avc1.640028"
	case strings.HasPrefix(pixels, "yuv420p10"):
		return "avc1.6e0028"
	case strings.HasPrefix(pixels, "yuv422p"):
		return "avc1.7a0028"
	case strings.HasPrefix(pixels, "yuv444p"):
		return "avc1.f40028"
	}
	return ""
}

// soundTypes are the names browsers know for sound formats; "" is a video
// with no sound.
var soundTypes = map[string]string{
	"": "", "aac": "mp4a.40.2", "mp3": "mp4a.6b", "opus": "opus", "vorbis": "vorbis",
	"flac": "flac", "ac3": "ac-3", "eac3": "ec-3",
}
