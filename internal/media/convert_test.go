package media

import (
	"cmp"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/video"
)

// convertFixture is a catalog with one video, already read by ffprobe,
// and a converter on a temp data folder.
type convertFixture struct {
	db      *sql.DB
	id      int64
	dataDir string
	c       *Converter
}

func newConvertFixture(t *testing.T, rel, videoCodec, audioCodec string) *convertFixture {
	t.Helper()
	db, id := catalog(t, "/videos", rel)
	if _, err := db.Exec(`UPDATE videos SET video_codec = ?, audio_codec = ?, pixel_format = 'yuv420p' WHERE id = ?`,
		videoCodec, audioCodec, id); err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	return &convertFixture{db: db, id: id, dataDir: dataDir, c: NewConverter(db, "ffmpeg", "ffprobe", dataDir)}
}

func (fx *convertFixture) converted(t *testing.T) sql.NullString {
	t.Helper()
	var s sql.NullString
	if err := fx.db.QueryRow(`SELECT converted FROM videos WHERE id = ?`, fx.id).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func (fx *convertFixture) files(t *testing.T) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(fx.dataDir, ConvertedDir))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

func TestConvertArgs(t *testing.T) {
	copyPicture := convertArgs("/v/film.mkv", video.ConvertPlan{Needed: true, CopyVideo: true},
		[]string{"ac3", "aac"}, 2, "/data/converted/.progress-1.txt", "/data/converted/.new-1.mp4")
	want := []string{"-v", "error", "-nostdin", "-y", "-i", "file:/v/film.mkv", "-map", "0:V:0", "-c:v", "copy",
		"-map", "0:a:0", "-c:a:0", "aac", "-ac:a:0", "2", "-b:a:0", "192k",
		"-map", "0:a:1", "-c:a:1", "copy",
		"-sn", "-dn", "-threads", "2", "-progress", "file:/data/converted/.progress-1.txt", "-stats_period", "5",
		"-movflags", "+faststart", "-f", "mp4", "file:/data/converted/.new-1.mp4"}
	if !slices.Equal(copyPicture, want) {
		t.Errorf("copy the picture:\n got %q\nwant %q", copyPicture, want)
	}

	encode := strings.Join(convertArgs("/v/film.avi", video.ConvertPlan{Needed: true}, nil, 1, "p.txt", "out.mp4"), " ")
	for _, part := range []string{"-c:v libx264", "-pix_fmt yuv420p", "yadif=deint=interlaced",
		"min(1080,trunc(ih/2)*2)", "-map 0:a? -c:a aac -ac 2"} {
		if !strings.Contains(encode, part) {
			t.Errorf("encode again: %q lacks %q", encode, part)
		}
	}
}

func TestConvertSkipsVideosThatPlayAsTheyAre(t *testing.T) {
	fx := newConvertFixture(t, "a.mp4", "h264", "aac")
	fx.c.run = func(context.Context, string, ...string) ([]byte, error) {
		t.Fatal("ffmpeg ran for a video that plays as it is")
		return nil, nil
	}
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if fx.converted(t).Valid {
		t.Error("copy saved")
	}
}

func TestConvertWaitsForFFprobe(t *testing.T) {
	db, id := catalog(t, "/videos", "a.mkv")
	c := NewConverter(db, "ffmpeg", "ffprobe", t.TempDir())
	if err := c.Handle(context.Background(), id); err == nil {
		t.Error("converted a video whose formats are not known")
	}
}

func TestConvertMakesACopyAndReplacesTheOldOne(t *testing.T) {
	fx := newConvertFixture(t, "film.mkv", "hevc", "ac3")
	if _, err := fx.db.Exec(`INSERT INTO video_audio (video_id, stream, lang, title, codec, channels, is_default)
		VALUES (?, 1, 'ita', '', 'ac3', 6, 1)`, fx.id); err != nil {
		t.Fatal(err)
	}
	var args []string
	write := fakeFFmpeg("mp4", nil)
	fx.c.run = func(ctx context.Context, program string, a ...string) ([]byte, error) {
		args = a
		return write(ctx, program, a...)
	}
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	first := fx.converted(t)
	if !first.Valid || !slices.Equal(fx.files(t), []string{first.String}) {
		t.Fatalf("copy %v, folder %q", first, fx.files(t))
	}
	if !slices.Contains(args, "file:/videos/film.mkv") || !slices.Contains(args, "-c:a:0") {
		t.Errorf("ffmpeg ran with %q", args)
	}

	// Asked again for the same content: nothing to do.
	args = nil
	if err := fx.c.Handle(context.Background(), fx.id); err != nil || args != nil {
		t.Fatalf("second run: %v, ffmpeg ran with %q", err, args)
	}

	// The file is replaced with a version every browser plays.
	if _, err := fx.db.Exec(`UPDATE videos SET fingerprint = 'v1:new', path = 'film.mp4', video_codec = 'h264',
		audio_codec = 'aac' WHERE id = ?`, fx.id); err != nil {
		t.Fatal(err)
	}
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if fx.converted(t).Valid || len(fx.files(t)) != 0 {
		t.Errorf("old copy kept: %v %q", fx.converted(t), fx.files(t))
	}
}

// A video read before FranzPLAY kept pixel formats: the converter asks
// ffprobe, keeps the answer, and a 10-bit H.264 is encoded again.
func TestConvertReadsThePixelsOfVideosReadBefore(t *testing.T) {
	fx := newConvertFixture(t, "anime.mp4", "h264", "aac")
	if _, err := fx.db.Exec(`UPDATE videos SET pixel_format = NULL WHERE id = ?`, fx.id); err != nil {
		t.Fatal(err)
	}
	var encoded bool
	write := fakeFFmpeg("mp4", nil)
	fx.c.run = func(ctx context.Context, program string, args ...string) ([]byte, error) {
		if program == "ffprobe" {
			return []byte(`{"format":{"duration":"5"},"streams":[
				{"codec_type":"video","codec_name":"h264","width":1280,"height":720,"pix_fmt":"yuv420p10le"}]}`), nil
		}
		encoded = slices.Contains(args, "libx264")
		return write(ctx, program, args...)
	}
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if !fx.converted(t).Valid || !encoded {
		t.Errorf("copy %v, encoded again %v", fx.converted(t), encoded)
	}
	var pixels string
	if err := fx.db.QueryRow(`SELECT pixel_format FROM videos WHERE id = ?`, fx.id).Scan(&pixels); err != nil {
		t.Fatal(err)
	}
	if pixels != "yuv420p10le" {
		t.Errorf("pixel format saved %q", pixels)
	}
}

func TestConvertFailuresLeaveNothingBehind(t *testing.T) {
	for name, run := range map[string]runFunc{
		"ffmpeg fails":                   fakeFFmpeg("half", errors.New("killed")),
		"ffmpeg writes nothing":          fakeFFmpeg("", nil),
		"stopped to let other work pass": fakeFFmpeg("half", context.Canceled),
	} {
		t.Run(name, func(t *testing.T) {
			fx := newConvertFixture(t, "film.avi", "mpeg4", "mp3")
			fx.c.run = run
			if err := fx.c.Handle(context.Background(), fx.id); err == nil {
				t.Fatal("no error")
			}
			if files := fx.files(t); len(files) != 0 {
				t.Errorf("files left: %q", files)
			}
			if fx.converted(t).Valid {
				t.Error("copy saved after a failure")
			}
		})
	}
}

func TestCopyOfContentThatChangedMeanwhileIsDropped(t *testing.T) {
	fx := newConvertFixture(t, "film.avi", "mpeg4", "mp3")
	write := fakeFFmpeg("mp4", nil)
	fx.c.run = func(ctx context.Context, program string, args ...string) ([]byte, error) {
		if _, err := fx.db.Exec(`UPDATE videos SET fingerprint = 'v1:other' WHERE id = ?`, fx.id); err != nil {
			t.Fatal(err)
		}
		return write(ctx, program, args...)
	}
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	if fx.converted(t).Valid || len(fx.files(t)) != 0 {
		t.Errorf("copy of the old content kept: %v %q", fx.converted(t), fx.files(t))
	}
}

func TestRemoveOrphanConverted(t *testing.T) {
	fx := newConvertFixture(t, "film.avi", "mpeg4", "mp3")
	fx.c.run = fakeFFmpeg("mp4", nil)
	if err := fx.c.Handle(context.Background(), fx.id); err != nil {
		t.Fatal(err)
	}
	kept := fx.converted(t).String
	dir := filepath.Join(fx.dataDir, ConvertedDir)
	for _, name := range []string{"99-forgotten.mp4", ".new-123.mp4"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	removed, err := RemoveOrphanConverted(context.Background(), fx.db, fx.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 2 || !slices.Equal(fx.files(t), []string{kept}) {
		t.Errorf("removed %d, folder now %q; want 2 removed and only %q", removed, fx.files(t), kept)
	}
}

// TestConvertWithRealFFmpeg makes two films no browser plays everywhere,
// converts them, and checks what the copies hold. Skipped where ffmpeg is
// missing.
func TestConvertWithRealFFmpeg(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not installed")
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe not installed")
	}
	root := t.TempDir()
	films := []struct {
		name   string
		make   []string // how ffmpeg makes the film, after its picture and two sounds
		codec  string   // its picture, as ffprobe names it
		pixels string
		sounds []string // as the tracks job lists them
		want   []string // what the copy holds
	}{
		// H.264 in Matroska with AC3 and Opus: the picture is copied, the
		// sounds become AAC (Safari plays no Opus in MP4 before 2023).
		{"due lingue.mkv", []string{"-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a:0", "ac3", "-c:a:1", "libopus"},
			"h264", "yuv420p", []string{"ac3", "opus"}, []string{"h264 yuv420p", "aac", "aac"}},
		// MPEG-4 in AVI: the picture is encoded again; sound tracks not listed yet.
		{"vecchio.avi", []string{"-c:v", "mpeg4", "-c:a", "mp3"},
			"mpeg4", "yuv420p", nil, []string{"h264 yuv420p", "aac", "aac"}},
		// 10-bit H.264 plays almost nowhere: encoded again, in 8 bits.
		{"anime.mkv", []string{"-c:v", "libx264", "-pix_fmt", "yuv420p10le", "-c:a", "aac"},
			"h264", "yuv420p10le", []string{"aac", "aac"}, []string{"h264 yuv420p", "aac", "aac"}},
		// VP9 and Opus in WebM: no iPhone before 2024 plays it.
		{"web.webm", []string{"-c:v", "libvpx-vp9", "-deadline", "realtime", "-c:a", "libopus"},
			"vp9", "yuv420p", []string{"opus", "opus"}, []string{"h264 yuv420p", "aac", "aac"}},
		// An odd size, as some old videos have: H.264 needs even numbers.
		{"strano.mov", []string{"-vf", "scale=161:121", "-c:v", "mjpeg", "-c:a", "pcm_s16le"},
			"mjpeg", "yuvj444p", []string{"pcm_s16le", "pcm_s16le"}, []string{"h264 yuv420p", "aac", "aac"}},
	}
	for _, f := range films {
		t.Run(f.name, func(t *testing.T) {
			args := append([]string{"-v", "error",
				"-f", "lavfi", "-i", "testsrc=duration=2:size=160x120:rate=10",
				"-f", "lavfi", "-i", "sine=frequency=440:duration=2",
				"-f", "lavfi", "-i", "sine=frequency=880:duration=2",
				"-map", "0", "-map", "1", "-map", "2"}, f.make...)
			if _, err := run(context.Background(), ffmpeg, append(args, "file:"+filepath.Join(root, f.name))...); err != nil {
				t.Fatal(err)
			}
			db, id := catalog(t, root, f.name)
			if _, err := db.Exec(`UPDATE videos SET video_codec = ?, audio_codec = ?, pixel_format = ? WHERE id = ?`,
				f.codec, cmp.Or(firstOf(f.sounds), "mp3"), f.pixels, id); err != nil {
				t.Fatal(err)
			}
			for i, s := range f.sounds {
				if _, err := db.Exec(`INSERT INTO video_audio (video_id, stream, lang, title, codec, channels, is_default)
					VALUES (?, ?, '', '', ?, 1, 0)`, id, i+1, s); err != nil {
					t.Fatal(err)
				}
			}
			dataDir := t.TempDir()
			if err := NewConverter(db, ffmpeg, ffprobe, dataDir).Handle(context.Background(), id); err != nil {
				t.Fatal(err)
			}
			var name string
			if err := db.QueryRow(`SELECT converted FROM videos WHERE id = ?`, id).Scan(&name); err != nil {
				t.Fatal(err)
			}
			if left, err := os.ReadDir(filepath.Join(dataDir, ConvertedDir)); err != nil || len(left) != 1 {
				t.Errorf("converted folder holds %v (%v), want only the copy", left, err)
			}
			out, err := run(context.Background(), ffprobe, "-v", "error", "-show_entries",
				"stream=codec_name,pix_fmt,width,height", "-of", "json", filepath.Join(dataDir, ConvertedDir, name))
			if err != nil {
				t.Fatal(err)
			}
			var probed struct {
				Streams []struct {
					Codec  string `json:"codec_name"`
					Pixels string `json:"pix_fmt"`
					Width  int    `json:"width"`
					Height int    `json:"height"`
				} `json:"streams"`
			}
			if err := json.Unmarshal(out, &probed); err != nil {
				t.Fatal(err)
			}
			var got []string
			for _, s := range probed.Streams {
				got = append(got, strings.TrimSpace(s.Codec+" "+s.Pixels))
				if s.Width%2 != 0 || s.Height%2 != 0 {
					t.Errorf("picture %dx%d: H.264 needs even sizes", s.Width, s.Height)
				}
			}
			if !slices.Equal(got, f.want) {
				t.Errorf("copy holds %q, want %q", got, f.want)
			}
		})
	}
}

// firstOf is the first item of a list, or "" when it is empty.
func firstOf(list []string) string {
	if len(list) == 0 {
		return ""
	}
	return list[0]
}

func TestConvertedSoFar(t *testing.T) {
	dataDir := t.TempDir()
	if _, ok, err := ConvertedSoFar(dataDir, 4); ok || err != nil {
		t.Errorf("no copy being made: ok %v, %v", ok, err)
	}
	dir := filepath.Join(dataDir, ConvertedDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	// What ffmpeg writes with -progress: a block every few seconds.
	progress := "frame=10\nout_time_us=2000000\nprogress=continue\n" +
		"frame=300\nout_time_us=12500000\nout_time=00:00:12.500000\nprogress=continue\n"
	if err := os.WriteFile(filepath.Join(dir, progressName(4)), []byte(progress), 0o600); err != nil {
		t.Fatal(err)
	}
	if got, ok, err := ConvertedSoFar(dataDir, 4); got != 12.5 || !ok || err != nil {
		t.Errorf("ConvertedSoFar = %v, %v, %v; want 12.5", got, ok, err)
	}
	// Just started: no time yet (ffmpeg writes N/A at first).
	if err := os.WriteFile(filepath.Join(dir, progressName(4)), []byte("out_time_us=N/A\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := ConvertedSoFar(dataDir, 4); ok || err != nil {
		t.Errorf("no time yet: ok %v, %v", ok, err)
	}
}
