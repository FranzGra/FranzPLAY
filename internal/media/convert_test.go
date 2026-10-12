package media

import (
	"context"
	"database/sql"
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
	if _, err := db.Exec(`UPDATE videos SET video_codec = ?, audio_codec = ? WHERE id = ?`,
		videoCodec, audioCodec, id); err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	return &convertFixture{db: db, id: id, dataDir: dataDir, c: NewConverter(db, "ffmpeg", dataDir)}
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
		[]string{"ac3", "aac"}, 2, "/data/converted/.new-1.mp4")
	want := []string{"-v", "error", "-nostdin", "-y", "-i", "file:/v/film.mkv", "-map", "0:V:0", "-c:v", "copy",
		"-map", "0:a:0", "-c:a:0", "aac", "-ac:a:0", "2", "-b:a:0", "192k",
		"-map", "0:a:1", "-c:a:1", "copy",
		"-sn", "-dn", "-threads", "2", "-movflags", "+faststart", "-f", "mp4", "file:/data/converted/.new-1.mp4"}
	if !slices.Equal(copyPicture, want) {
		t.Errorf("copy the picture:\n got %q\nwant %q", copyPicture, want)
	}

	encode := strings.Join(convertArgs("/v/film.avi", video.ConvertPlan{Needed: true}, nil, 1, "out.mp4"), " ")
	for _, part := range []string{"-c:v libx264", "-pix_fmt yuv420p", "min(1080,ih)", "-map 0:a? -c:a aac -ac 2"} {
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
	c := NewConverter(db, "ffmpeg", t.TempDir())
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
		name, video, audio string
		sounds             []string // as the tracks job lists them
		wantSounds         []string
	}{
		// H.264 in Matroska with AC3 and Opus: the picture is copied.
		{"due lingue.mkv", "libx264", "ac3", []string{"ac3", "opus"}, []string{"aac", "opus"}},
		// MPEG-4 in AVI: the picture is encoded again; sound tracks not listed yet.
		{"vecchio.avi", "mpeg4", "mp3", nil, []string{"aac", "aac"}},
	}
	for _, f := range films {
		t.Run(f.name, func(t *testing.T) {
			if _, err := run(context.Background(), ffmpeg, "-v", "error",
				"-f", "lavfi", "-i", "testsrc=duration=2:size=160x120:rate=10",
				"-f", "lavfi", "-i", "sine=frequency=440:duration=2",
				"-f", "lavfi", "-i", "sine=frequency=880:duration=2",
				"-map", "0", "-map", "1", "-map", "2", "-c:v", f.video,
				"-c:a:0", f.audio, "-c:a:1", map[bool]string{true: "libopus", false: "mp3"}[f.sounds != nil],
				"file:"+filepath.Join(root, f.name)); err != nil {
				t.Fatal(err)
			}
			db, id := catalog(t, root, f.name)
			codec := map[string]string{"libx264": "h264", "mpeg4": "mpeg4"}[f.video]
			if _, err := db.Exec(`UPDATE videos SET video_codec = ?, audio_codec = ? WHERE id = ?`, codec, f.audio, id); err != nil {
				t.Fatal(err)
			}
			for i, s := range f.sounds {
				if _, err := db.Exec(`INSERT INTO video_audio (video_id, stream, lang, title, codec, channels, is_default)
					VALUES (?, ?, '', '', ?, 1, 0)`, id, i+1, s); err != nil {
					t.Fatal(err)
				}
			}
			dataDir := t.TempDir()
			if err := NewConverter(db, ffmpeg, dataDir).Handle(context.Background(), id); err != nil {
				t.Fatal(err)
			}
			var name string
			if err := db.QueryRow(`SELECT converted FROM videos WHERE id = ?`, id).Scan(&name); err != nil {
				t.Fatal(err)
			}
			out, err := run(context.Background(), ffprobe, "-v", "error", "-show_entries", "stream=codec_name",
				"-of", "csv=p=0", filepath.Join(dataDir, ConvertedDir, name))
			if err != nil {
				t.Fatal(err)
			}
			want := append([]string{"h264"}, f.wantSounds...)
			if got := strings.Fields(string(out)); !slices.Equal(got, want) {
				t.Errorf("copy holds %q, want %q", got, want)
			}
		})
	}
}
