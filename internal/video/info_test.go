package video

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func readTestdata(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// The testdata files are real ffprobe answers, made with ProbeArgs.
func TestParseProbeRealOutput(t *testing.T) {
	tests := []struct {
		file string
		want Info
	}{
		{"probe-mp4.json", Info{
			Duration: Duration{seconds: 3}, Width: 320, Height: 240,
			VideoCodec: "h264", AudioCodec: "aac", Container: "mov,mp4,m4a,3gp,3g2,mj2",
		}},
		// Filmed with the phone upright: stored 320x240, shown 240x320.
		{"probe-rotated.json", Info{
			Duration: Duration{seconds: 3}, Width: 240, Height: 320,
			VideoCodec: "h264", AudioCodec: "aac", Container: "mov,mp4,m4a,3gp,3g2,mj2",
		}},
	}
	for _, tt := range tests {
		t.Run(tt.file, func(t *testing.T) {
			got, err := ParseProbe(readTestdata(t, tt.file))
			if err != nil {
				t.Fatal(err)
			}
			if got != tt.want {
				t.Errorf("ParseProbe()\n got  %+v\n want %+v", got, tt.want)
			}
		})
	}
}

func TestParseProbeCases(t *testing.T) {
	tests := []struct {
		name string
		json string
		want Info
	}{
		{
			name: "cover image stream is not the video",
			json: `{"format":{"duration":"10"},"streams":[
				{"codec_type":"video","codec_name":"mjpeg","width":600,"height":600,"disposition":{"attached_pic":1}},
				{"codec_type":"video","codec_name":"hevc","width":1920,"height":1080}]}`,
			want: Info{Duration: Duration{seconds: 10}, Width: 1920, Height: 1080, VideoCodec: "hevc"},
		},
		{
			name: "duration only on the stream",
			json: `{"format":{"duration":"N/A"},"streams":[
				{"codec_type":"video","codec_name":"vp9","width":640,"height":360,"duration":"61.6"}]}`,
			want: Info{Duration: Duration{seconds: 62}, Width: 640, Height: 360, VideoCodec: "vp9"},
		},
		{
			name: "no duration at all",
			json: `{"format":{},"streams":[{"codec_type":"video","codec_name":"h264","width":640,"height":360}]}`,
			want: Info{Width: 640, Height: 360, VideoCodec: "h264"},
		},
		{
			name: "old rotate tag, turned the other way",
			json: `{"format":{"duration":"1"},"streams":[
				{"codec_type":"video","codec_name":"h264","width":1920,"height":1080,"tags":{"rotate":"-270"}}]}`,
			want: Info{Duration: Duration{seconds: 1}, Width: 1080, Height: 1920, VideoCodec: "h264"},
		},
		{
			name: "upside down keeps its size",
			json: `{"format":{"duration":"1"},"streams":[
				{"codec_type":"video","codec_name":"h264","width":1920,"height":1080,"side_data_list":[{"rotation":180}]}]}`,
			want: Info{Duration: Duration{seconds: 1}, Width: 1920, Height: 1080, VideoCodec: "h264"},
		},
		{
			name: "first audio track wins",
			json: `{"format":{"duration":"1"},"streams":[
				{"codec_type":"audio","codec_name":"opus"},
				{"codec_type":"video","codec_name":"vp9","width":2,"height":2},
				{"codec_type":"audio","codec_name":"aac"}]}`,
			want: Info{Duration: Duration{seconds: 1}, Width: 2, Height: 2, VideoCodec: "vp9", AudioCodec: "opus"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ParseProbe([]byte(tt.json))
			if err != nil {
				t.Fatal(err)
			}
			if got != tt.want {
				t.Errorf("ParseProbe()\n got  %+v\n want %+v", got, tt.want)
			}
		})
	}
}

func TestParseProbeRejects(t *testing.T) {
	tests := []struct {
		name string
		json string
		want error
	}{
		{"not JSON", `ffprobe: error`, ErrBadProbe},
		{"empty answer", `{}`, ErrNotVideo},
		{"audio only", `{"streams":[{"codec_type":"audio","codec_name":"mp3"}]}`, ErrNotVideo},
		{"only a cover image", `{"streams":[{"codec_type":"video","width":1,"height":1,"disposition":{"attached_pic":1}}]}`, ErrNotVideo},
		{"picture without size", `{"streams":[{"codec_type":"video","codec_name":"h264"}]}`, ErrBadProbe},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseProbe([]byte(tt.json))
			if !errors.Is(err, tt.want) {
				t.Errorf("error = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestQuarterTurn(t *testing.T) {
	tests := map[float64]bool{0: false, 90: true, -90: true, 180: false, 270: true, -270: true, 360: false, 45: false}
	for degrees, want := range tests {
		if got := quarterTurn(degrees); got != want {
			t.Errorf("quarterTurn(%v) = %v, want %v", degrees, got, want)
		}
	}
}
