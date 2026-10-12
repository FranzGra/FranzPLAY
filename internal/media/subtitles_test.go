package media

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// subtitleFixture is a catalog with one video and a subtitler on a temp
// data folder.
type subtitleFixture struct {
	fx      *previewFixture // same catalog and data folder
	s       *Subtitler
	ffmpegs int // how many times ffmpeg ran
}

func newSubtitleFixture(t *testing.T, probe string) *subtitleFixture {
	t.Helper()
	pf := newPreviewFixture(t, "/videos", "film.mkv", 60)
	sf := &subtitleFixture{fx: pf, s: NewSubtitler(pf.db, "ffprobe", "ffmpeg", pf.dataDir)}
	sf.s.run = func(_ context.Context, program string, args ...string) ([]byte, error) {
		if program == "ffprobe" {
			return []byte(probe), nil
		}
		sf.ffmpegs++
		// Pretend to be ffmpeg: write each output file named in the command.
		for _, a := range args {
			if strings.HasSuffix(a, ".vtt") {
				if err := os.WriteFile(a, []byte("WEBVTT\n\n00:01.000 --> 00:02.000\nCiao\n"), 0o600); err != nil {
					return nil, err
				}
			}
		}
		return nil, nil
	}
	return sf
}

type savedSubtitle struct {
	stream      int
	lang, title string
	forced      bool
	file        string
}

func (sf *subtitleFixture) saved(t *testing.T) []savedSubtitle {
	t.Helper()
	rows, err := sf.fx.db.Query(`SELECT stream, lang, title, forced, file FROM video_subtitles WHERE video_id = ? ORDER BY stream`, sf.fx.id)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			t.Error(err)
		}
	}()
	var out []savedSubtitle
	for rows.Next() {
		var s savedSubtitle
		if err := rows.Scan(&s.stream, &s.lang, &s.title, &s.forced, &s.file); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func (sf *subtitleFixture) files(t *testing.T) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(sf.fx.dataDir, SubtitlesDir))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

const twoSubtitles = `{"streams": [
	{"index": 2, "codec_name": "subrip", "tags": {"language": "ita"}},
	{"index": 3, "codec_name": "hdmv_pgs_subtitle", "tags": {"language": "ita"}},
	{"index": 4, "codec_name": "ass", "tags": {"language": "eng", "title": "Forced"}, "disposition": {"forced": 1}}
]}`

func TestSubtitlesSaved(t *testing.T) {
	sf := newSubtitleFixture(t, twoSubtitles)
	if err := sf.s.Handle(context.Background(), sf.fx.id); err != nil {
		t.Fatal(err)
	}
	want := []savedSubtitle{
		{stream: 2, lang: "ita", file: "1-fp-2.vtt"},
		{stream: 4, lang: "eng", title: "Forced", forced: true, file: "1-fp-4.vtt"},
	}
	if got := sf.saved(t); !slices.Equal(got, want) {
		t.Errorf("saved %+v\nwant  %+v", got, want)
	}
	if files := sf.files(t); !slices.Equal(files, []string{"1-fp-2.vtt", "1-fp-4.vtt"}) {
		t.Errorf("files = %q", files)
	}
	if sf.ffmpegs != 1 {
		t.Errorf("ffmpeg ran %d times, want once for all subtitles", sf.ffmpegs)
	}
}

func TestSubtitlesOfAFileWithoutAny(t *testing.T) {
	sf := newSubtitleFixture(t, `{"streams": [{"index": 3, "codec_name": "dvd_subtitle"}]}`)
	if err := sf.s.Handle(context.Background(), sf.fx.id); err != nil {
		t.Fatal(err)
	}
	if len(sf.saved(t)) != 0 || len(sf.files(t)) != 0 || sf.ffmpegs != 0 {
		t.Errorf("saved %+v, files %q, ffmpeg ran %d times; want nothing", sf.saved(t), sf.files(t), sf.ffmpegs)
	}
}

func TestNewSubtitlesReplaceTheOldOnes(t *testing.T) {
	sf := newSubtitleFixture(t, twoSubtitles)
	if err := sf.s.Handle(context.Background(), sf.fx.id); err != nil {
		t.Fatal(err)
	}
	// The file changed: now only the English subtitle is there.
	if _, err := sf.fx.db.Exec(`UPDATE videos SET fingerprint = 'v1:new' WHERE id = ?`, sf.fx.id); err != nil {
		t.Fatal(err)
	}
	sf.s.run = newSubtitleFixture(t, `{"streams": [{"index": 4, "codec_name": "subrip", "tags": {"language": "eng"}}]}`).s.run
	if err := sf.s.Handle(context.Background(), sf.fx.id); err != nil {
		t.Fatal(err)
	}
	want := []savedSubtitle{{stream: 4, lang: "eng", file: "1-v1:new-4.vtt"}}
	if got := sf.saved(t); !slices.Equal(got, want) {
		t.Errorf("saved %+v, want %+v", got, want)
	}
	if files := sf.files(t); !slices.Equal(files, []string{"1-v1:new-4.vtt"}) {
		t.Errorf("files = %q, want only the new copy", files)
	}
}

func TestSubtitleFailuresLeaveNothingBehind(t *testing.T) {
	for _, failing := range []string{"ffprobe", "ffmpeg"} {
		t.Run(failing, func(t *testing.T) {
			sf := newSubtitleFixture(t, twoSubtitles)
			ok := sf.s.run
			sf.s.run = func(ctx context.Context, program string, args ...string) ([]byte, error) {
				if program == failing {
					return nil, errors.New("broken file")
				}
				return ok(ctx, program, args...)
			}
			if err := sf.s.Handle(context.Background(), sf.fx.id); err == nil {
				t.Fatal("no error")
			}
			if len(sf.saved(t)) != 0 || len(sf.files(t)) != 0 {
				t.Errorf("left behind: %+v %q", sf.saved(t), sf.files(t))
			}
		})
	}
}

func TestSubtitlesOfContentThatChangedMeanwhileAreDropped(t *testing.T) {
	sf := newSubtitleFixture(t, twoSubtitles)
	ok := sf.s.run
	sf.s.run = func(ctx context.Context, program string, args ...string) ([]byte, error) {
		if _, err := sf.fx.db.Exec(`UPDATE videos SET fingerprint = 'v1:other' WHERE id = ?`, sf.fx.id); err != nil {
			t.Fatal(err)
		}
		return ok(ctx, program, args...)
	}
	if err := sf.s.Handle(context.Background(), sf.fx.id); err != nil {
		t.Fatal(err)
	}
	if len(sf.saved(t)) != 0 || len(sf.files(t)) != 0 {
		t.Errorf("subtitles of the old content kept: %+v %q", sf.saved(t), sf.files(t))
	}
}

func TestRemoveOrphanSubtitles(t *testing.T) {
	sf := newSubtitleFixture(t, twoSubtitles)
	if err := sf.s.Handle(context.Background(), sf.fx.id); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(sf.fx.dataDir, SubtitlesDir)
	if err := os.WriteFile(filepath.Join(dir, "99-forgotten-2.vtt"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, ".new-1"), 0o750); err != nil {
		t.Fatal(err)
	}
	removed, err := RemoveOrphanSubtitles(context.Background(), sf.fx.db, sf.fx.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"1-fp-2.vtt", "1-fp-4.vtt"}; removed != 2 || !slices.Equal(sf.files(t), want) {
		t.Errorf("removed %d, folder now %q; want 2 removed and %q", removed, sf.files(t), want)
	}
}

// TestSubtitlesWithRealFFmpeg makes a small .mkv with an Italian subtitle
// inside and copies it out. Skipped where ffmpeg is missing.
func TestSubtitlesWithRealFFmpeg(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not installed")
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe not installed")
	}
	root, work := t.TempDir(), t.TempDir()
	srt := filepath.Join(work, "it.srt")
	if err := os.WriteFile(srt, []byte("1\n00:00:00,500 --> 00:00:01,500\nPerché sì\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	name := filepath.Join(root, "film: uno.mkv")
	if _, err := run(context.Background(), ffmpeg, "-v", "error",
		"-f", "lavfi", "-i", "testsrc=duration=2:size=160x120:rate=10", "-i", "file:"+srt,
		"-map", "0", "-map", "1", "-c:s", "srt", "-metadata:s:s:0", "language=ita",
		"-pix_fmt", "yuv420p", "file:"+name); err != nil {
		t.Fatal(err)
	}
	pf := newPreviewFixture(t, root, "film: uno.mkv", 2)
	s := NewSubtitler(pf.db, ffprobe, ffmpeg, pf.dataDir)
	libraryBefore := listDir(t, root)

	if err := s.Handle(context.Background(), pf.id); err != nil {
		t.Fatal(err)
	}
	sf := &subtitleFixture{fx: pf, s: s}
	saved := sf.saved(t)
	if len(saved) != 1 || saved[0].lang != "ita" {
		t.Fatalf("saved %+v, want one Italian subtitle", saved)
	}
	data, err := os.ReadFile(filepath.Join(pf.dataDir, SubtitlesDir, saved[0].file))
	if err != nil {
		t.Fatal(err)
	}
	if text := string(data); !strings.HasPrefix(text, "WEBVTT") || !strings.Contains(text, "Perché sì") {
		t.Errorf("copy is not the subtitle as WebVTT:\n%s", text)
	}
	if after := listDir(t, root); !slices.Equal(after, libraryBefore) {
		t.Errorf("the video folder changed:\nbefore %q\nafter  %q", libraryBefore, after)
	}
}
