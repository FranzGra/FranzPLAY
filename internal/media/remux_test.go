package media

import (
	"bytes"
	"context"
	"errors"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestRemuxArgs(t *testing.T) {
	tests := []struct {
		name  string
		track int
		codec string
		start float64
		want  []string // must appear, in this order
		not   []string
	}{
		{"browser sound is copied", 1, "aac", 0,
			[]string{"-i", "file:/v/film.mkv", "-map", "0:V:0", "-map", "0:a:1", "-c:v", "copy", "-c:a", "copy"},
			[]string{"-ss", "-ac"}},
		{"film sound is converted", 0, "ac3", 12.5,
			[]string{"-ss", "12.5", "-i", "file:/v/film.mkv", "-map", "0:a:0", "-c:a", "aac", "-ac", "2"},
			nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			args := remuxArgs("/v/film.mkv", tt.track, tt.codec, tt.start)
			if !containsInOrder(args, tt.want) {
				t.Errorf("args %q do not contain %q in order", args, tt.want)
			}
			for _, a := range tt.not {
				if slices.Contains(args, a) {
					t.Errorf("args %q contain %q", args, a)
				}
			}
			if args[len(args)-1] != "pipe:1" {
				t.Errorf("args %q do not end writing to the output", args)
			}
		})
	}
}

// containsInOrder reports whether want appears in args, in order, maybe
// with other arguments between.
func containsInOrder(args, want []string) bool {
	i := 0
	for _, a := range args {
		if i < len(want) && a == want[i] {
			i++
		}
	}
	return i == len(want)
}

func TestRemuxerSaysWhenBusy(t *testing.T) {
	m := NewRemuxer("ffmpeg", 1)
	m.slots <- struct{}{} // someone is already watching
	err := m.Stream(context.Background(), &bytes.Buffer{}, "/v/film.mkv", 0, "aac", 0)
	if !errors.Is(err, ErrBusy) {
		t.Errorf("Stream = %v, want ErrBusy", err)
	}
}

func TestStartOf(t *testing.T) {
	const answer = "#software: Lavf60.16.100\n#tb 0: 1/1000\n#media_type 0: video\n0,      -1993,      -1993,       40,     9765, 0xa6e004f7\n"
	m := NewRemuxer("ffmpeg", 1)
	var args []string
	m.run = fakeRun(answer, nil, &args)
	got, err := m.StartOf(context.Background(), "/v/film.mkv", 14)
	if err != nil || got != 12.007 {
		t.Errorf("StartOf = %v, %v; want 12.007", got, err)
	}
	if want := startArgs("/v/film.mkv", 14); !slices.Equal(args, want) {
		t.Errorf("ffmpeg ran with %q, want %q", args, want)
	}

	m.run = fakeRun("", errors.New("must not run"), new([]string))
	if got, err := m.StartOf(context.Background(), "/v/film.mkv", 0); err != nil || got != 0 {
		t.Errorf("StartOf(0) = %v, %v; want 0 without ffmpeg", got, err)
	}
}

func TestParseFirstPacket(t *testing.T) {
	good := map[string]float64{
		"#tb 0: 1/1000\n0, -2000, -2000, 40, 1, 0x0\n":     -2,
		"#tb 0: 1/12800\n0, -42240, -42240, 512, 1, 0x0\n": -3.3,
		"#tb 0: 1/1000\n0, 0, 0, 40, 1, 0x0\n":             0,
		"#tb 0: 1/90000\n0, 9, 9, 3000, 1, 0x0\n":          0, // rounding, not after at
	}
	for answer, want := range good {
		if got, err := parseFirstPacket([]byte(answer)); err != nil || got != want {
			t.Errorf("%q: %v, %v; want %v", answer, got, err, want)
		}
	}
	for _, answer := range []string{
		"",                                       // no picture there
		"0, -2000, -2000, 40, 1, 0x0\n",          // no unit of time
		"#tb 0: 1/1000\n0, 5000, 5000, 40\n",     // after at
		"#tb 0: 1/1000\n0, -9000000, -9000000\n", // hours before
		"#tb 0: 1/1000\n0, soon, soon\n",
	} {
		if _, err := parseFirstPacket([]byte(answer)); err == nil {
			t.Errorf("answer %q accepted", answer)
		}
	}
}

// TestRemuxWithRealFFmpeg makes a film with an Italian AC3-like sound and
// an English one, a key frame every 5 seconds, then plays it from the
// middle with the second sound. Skipped where ffmpeg is missing.
func TestRemuxWithRealFFmpeg(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not installed")
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe not installed")
	}
	dir := t.TempDir()
	name := filepath.Join(dir, "film: due lingue.mkv")
	if _, err := run(context.Background(), ffmpeg, "-v", "error",
		"-f", "lavfi", "-i", "testsrc=duration=12:size=160x120:rate=10",
		"-f", "lavfi", "-i", "sine=frequency=440:duration=12",
		"-f", "lavfi", "-i", "sine=frequency=880:duration=12",
		"-map", "0", "-map", "1", "-map", "2", "-g", "50", "-keyint_min", "50", "-pix_fmt", "yuv420p",
		"-c:a:0", "ac3", "-c:a:1", "libmp3lame", "file:"+name); err != nil {
		t.Fatal(err)
	}
	m := NewRemuxer(ffmpeg, 2)

	start, err := m.StartOf(context.Background(), name, 7.5)
	// The key frame is at 5; the sound tracks' small delay may add a few
	// milliseconds.
	if err != nil || math.Abs(start-5) > 0.05 {
		t.Fatalf("start of 7.5 = %v, %v; want the key frame at 5", start, err)
	}

	for track, codec := range []string{"ac3", "mp3"} {
		var out bytes.Buffer
		if err := m.Stream(context.Background(), &out, name, track, codec, 7.5); err != nil {
			t.Fatal(err)
		}
		mp4 := filepath.Join(dir, "out.mp4")
		if err := os.WriteFile(mp4, out.Bytes(), 0o600); err != nil {
			t.Fatal(err)
		}
		probe, err := run(context.Background(), ffprobe, "-v", "error", "-show_entries", "stream=codec_type,codec_name",
			"-of", "csv=p=0", mp4)
		if err != nil {
			t.Fatal(err)
		}
		wantSound := "aac"
		if codec == "mp3" {
			wantSound = "mp3"
		}
		if got := strings.Fields(string(probe)); !slices.Equal(got, []string{"h264,video", wantSound + ",audio"}) {
			t.Errorf("sound %d: streams %q, want the picture and %s", track, got, wantSound)
		}
	}
}
