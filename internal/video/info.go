package video

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// ErrNotVideo means the file has no video picture: an audio file with a
// video extension, or a broken file.
var ErrNotVideo = errors.New("no video stream")

// ErrBadProbe means ffprobe's answer could not be understood.
var ErrBadProbe = errors.New("unreadable ffprobe output")

// Info is what FranzPLAY knows about a video file's content.
type Info struct {
	Duration   Duration
	Width      int    // as shown on screen (phone videos turned sideways are swapped)
	Height     int    // as shown on screen
	VideoCodec string // like "h264", "hevc", "vp9"
	AudioCodec string // like "aac", "opus"; "" when there is no sound
	// PixelFormat is how the picture stores its colours, like "yuv420p";
	// "yuv420p10le" is a 10-bit picture. "" = not known.
	PixelFormat string
	Container   string // ffprobe format names, like "mov,mp4,m4a,3gp,3g2,mj2"
}

// ProbeArgs are the ffprobe arguments whose output ParseProbe reads.
// They live here, next to the parser, so the two cannot drift apart.
var ProbeArgs = []string{
	"-v", "error",
	"-print_format", "json",
	"-show_entries",
	"format=format_name,duration:" +
		"stream=codec_type,codec_name,width,height,duration,pix_fmt:" +
		"stream_disposition=attached_pic:" +
		"stream_tags=rotate:" +
		"stream_side_data=rotation",
}

// probeOutput mirrors the part of ffprobe's JSON that FranzPLAY reads.
type probeOutput struct {
	Format struct {
		FormatName string `json:"format_name"`
		Duration   string `json:"duration"`
	} `json:"format"`
	Streams []probeStream `json:"streams"`
}

type probeStream struct {
	CodecType   string `json:"codec_type"`
	CodecName   string `json:"codec_name"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	Duration    string `json:"duration"`
	PixFmt      string `json:"pix_fmt"`
	Disposition struct {
		AttachedPic int `json:"attached_pic"`
	} `json:"disposition"`
	Tags struct {
		Rotate string `json:"rotate"`
	} `json:"tags"`
	SideData []struct {
		Rotation *float64 `json:"rotation"`
	} `json:"side_data_list"`
}

// ParseProbe reads ffprobe's JSON answer (see ProbeArgs) into an Info.
// It is the only place where ffprobe's output enters FranzPLAY: everything
// is checked here, once.
func ParseProbe(data []byte) (Info, error) {
	var out probeOutput
	if err := json.Unmarshal(data, &out); err != nil {
		return Info{}, fmt.Errorf("%w: %w", ErrBadProbe, err)
	}

	var picture *probeStream
	var info Info
	for i := range out.Streams {
		s := &out.Streams[i]
		switch {
		case s.CodecType == "video" && s.Disposition.AttachedPic == 0 && picture == nil:
			picture = s
		case s.CodecType == "audio" && info.AudioCodec == "":
			info.AudioCodec = s.CodecName
		}
	}
	if picture == nil {
		return Info{}, ErrNotVideo
	}
	if picture.Width <= 0 || picture.Height <= 0 {
		return Info{}, fmt.Errorf("%w: picture size %dx%d", ErrBadProbe, picture.Width, picture.Height)
	}

	info.VideoCodec = picture.CodecName
	info.PixelFormat = pixelFormat(picture.PixFmt)
	info.Container = out.Format.FormatName
	info.Width, info.Height = picture.Width, picture.Height
	if quarterTurn(rotation(picture)) {
		info.Width, info.Height = info.Height, info.Width
	}

	// The container usually knows the duration; some files only have it on
	// the video stream. A file with no readable duration still plays: 0.
	for _, d := range []string{out.Format.Duration, picture.Duration} {
		if parsed, err := ParseProbeDuration(d); err == nil {
			info.Duration = parsed
			break
		}
	}
	return info, nil
}

// rotation returns how many degrees a phone turned the picture.
// Newer ffprobe versions report it in side data, older ones in a tag.
func rotation(s *probeStream) float64 {
	for _, sd := range s.SideData {
		if sd.Rotation != nil {
			return *sd.Rotation
		}
	}
	if r, err := strconv.ParseFloat(strings.TrimSpace(s.Tags.Rotate), 64); err == nil {
		return r
	}
	return 0
}

// quarterTurn reports whether a rotation turns the picture sideways
// (90 or 270 degrees, in either direction).
func quarterTurn(degrees float64) bool {
	turns := int(degrees) / 90
	return int(degrees)%90 == 0 && turns%2 != 0
}

// pixelFormat keeps ffprobe's name of a pixel format, like "yuv420p",
// when it looks like one: a short name in lower case letters, digits and
// "_". Anything else is "" (not known).
func pixelFormat(s string) string {
	if len(s) > 32 {
		return ""
	}
	for _, r := range s {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '_' {
			return ""
		}
	}
	return s
}
