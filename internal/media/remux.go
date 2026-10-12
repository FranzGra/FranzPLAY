package media

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/FranzGra/FranzPLAY/internal/video"
)

// ErrBusy means too many videos are being played with another sound
// track at the same time: the machine would slow down for everyone.
var ErrBusy = errors.New("too many videos playing with another sound track")

// Remuxer plays a video with one of its other sound tracks. Browsers
// always play the first track of a file, so ffmpeg makes, while the video
// plays, a new MP4 with the picture as it is and the sound track chosen.
// The picture is only copied, never converted: it costs little, even on a
// Raspberry Pi. Nothing is written to disk.
type Remuxer struct {
	ffmpeg string // program to run
	run    runFunc
	slots  chan struct{} // one per video playing this way
}

// NewRemuxer returns a remuxer that runs ffmpeg, for at most players
// videos at a time.
func NewRemuxer(ffmpeg string, players int) *Remuxer {
	return &Remuxer{ffmpeg: ffmpeg, run: run, slots: make(chan struct{}, players)}
}

// StartOf returns where, in seconds, the video made by Stream from at
// really begins. The new MP4 can only begin on a key frame: ffmpeg jumps
// to one a little before at. Asking ffmpeg itself, with the same jump,
// is the only sure way to know which: the player then counts its time
// from there and moves on to at by itself.
func (m *Remuxer) StartOf(ctx context.Context, file string, at float64) (float64, error) {
	if at <= 0 {
		return 0, nil
	}
	out, err := m.run(ctx, m.ffmpeg, startArgs(file, at)...)
	if err != nil {
		return 0, fmt.Errorf("find where the video starts: %w", err)
	}
	before, err := parseFirstPacket(out)
	if err != nil {
		return 0, fmt.Errorf("find where the video starts: %w", err)
	}
	// Milliseconds are plenty, and keep the addresses short.
	return math.Round(max(0, at+before)*1000) / 1000, nil
}

// startArgs builds the ffmpeg command for StartOf: the same jump as
// remuxArgs, then the first packet of the picture, described in text.
// Its time is counted from at, so it is zero or less.
func startArgs(file string, at float64) []string {
	return []string{
		"-v", "error", "-nostdin", "-ss", seconds(at), "-i", "file:" + file,
		"-map", "0:V:0", "-c", "copy", "-frames:v", "1", "-f", "framecrc", "-",
	}
}

// parseFirstPacket reads the answer of startArgs: a "#tb 0: 1/1000" line
// with the unit of time, then "0, dts, pts, ..." for the packet. It
// returns the time of the packet in seconds.
func parseFirstPacket(out []byte) (float64, error) {
	var num, den int64
	for line := range strings.Lines(string(out)) {
		line = strings.TrimSpace(line)
		if tb, ok := strings.CutPrefix(line, "#tb 0:"); ok {
			n, d, _ := strings.Cut(strings.TrimSpace(tb), "/")
			num, _ = strconv.ParseInt(n, 10, 64)
			den, _ = strconv.ParseInt(d, 10, 64)
			continue
		}
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Split(line, ",")
		if len(fields) < 3 || num <= 0 || den <= 0 {
			return 0, fmt.Errorf("unexpected answer %q", line)
		}
		pts, err := strconv.ParseInt(strings.TrimSpace(fields[2]), 10, 64)
		if err != nil {
			return 0, fmt.Errorf("unexpected answer %q", line)
		}
		t := float64(pts) * float64(num) / float64(den)
		// Never after at, and a key frame is not minutes away.
		if t > 0.001 || t < -maxKeyframeGap {
			return 0, fmt.Errorf("unexpected time %v", t)
		}
		return min(t, 0), nil
	}
	return 0, errors.New("no picture at that time")
}

// maxKeyframeGap is the longest wait between two key frames believed.
const maxKeyframeGap = 600

// Stream writes to w the video in file from at (in truth from StartOf)
// with the sound track audio, as a fragmented MP4 a browser plays while it
// arrives. It stops when ctx ends, as when the person closes the page.
func (m *Remuxer) Stream(ctx context.Context, w io.Writer, file string, audio video.EmbeddedAudio, at float64) error {
	select {
	case m.slots <- struct{}{}:
		defer func() { <-m.slots }()
	default:
		return ErrBusy
	}
	cmd := exec.CommandContext(ctx, m.ffmpeg, remuxArgs(file, audio, at)...)
	var stderr bytes.Buffer
	cmd.Stdout = w
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil // the person went away: nothing went wrong
		}
		msg := strings.TrimSpace(stderr.String())
		if len(msg) > 500 {
			msg = "…" + msg[len(msg)-500:]
		}
		return fmt.Errorf("%s: %w: %s", filepath.Base(m.ffmpeg), err, msg)
	}
	return nil
}

// remuxArgs builds the ffmpeg command for Stream. The picture is copied
// (V:0 leaves out cover images); the sound is copied too when the browser
// knows it, or else converted to stereo AAC.
func remuxArgs(file string, audio video.EmbeddedAudio, at float64) []string {
	args := []string{"-v", "error", "-nostdin"}
	if at > 0 {
		args = append(args, "-ss", seconds(at))
	}
	args = append(args,
		"-i", "file:"+file,
		"-map", "0:V:0", "-map", "0:"+strconv.Itoa(audio.Stream),
		"-c:v", "copy",
	)
	if video.CopyAudioToMP4(audio.Codec) {
		args = append(args, "-c:a", "copy")
	} else {
		args = append(args, "-c:a", "aac", "-ac", "2", "-b:a", "192k")
	}
	return append(args,
		"-sn", "-dn",
		"-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof",
		"pipe:1",
	)
}

// seconds writes a time for ffmpeg: "12.5".
func seconds(t float64) string {
	return strconv.FormatFloat(t, 'f', -1, 64)
}
