package video

// MaxConvertHeight is the tallest picture of a converted copy: a 4K film
// becomes 1080p. Encoding more would take far too long on a Raspberry Pi,
// and a home screen hardly shows the difference.
const MaxConvertHeight = 1080

// ConvertPlan says how to make a copy of a video that every browser plays.
type ConvertPlan struct {
	Needed    bool // false: the file plays as it is, no copy is made
	CopyVideo bool // the picture goes into the copy as it is, in minutes; else it is encoded again, in hours
}

// PlanConversion decides whether a video needs a copy, and how. ext is the
// file extension, like ".mkv"; info is what ffprobe found. The picture is
// copied only when every device decodes it (see DirectlyPlayable): a VP9,
// AV1 or HEVC picture would play in some browsers and not on an iPhone.
func PlanConversion(ext string, info Info) ConvertPlan {
	if info.VideoCodec == "" || DirectlyPlayable(ext, info) {
		return ConvertPlan{}
	}
	return ConvertPlan{Needed: true, CopyVideo: plainPicture(info)}
}

// MP4AudioCodec is the sound a copy holds for a sound track of the file:
// the same when it can go into an MP4 as it is, else AAC.
func MP4AudioCodec(codec string) string {
	if CopyAudioToMP4(codec) {
		return codec
	}
	return "aac"
}
