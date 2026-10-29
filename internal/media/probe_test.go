package media

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/database"
	"github.com/FranzGra/FranzPLAY/internal/jobs"
)

// catalog is a database with one library at root and one video in it.
func catalog(t *testing.T, root, rel string) (*sql.DB, int64) {
	t.Helper()
	db, err := database.Open(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Error(err)
		}
	})
	if _, err := db.Exec(`INSERT INTO libraries (id, path) VALUES (1, ?)`, root); err != nil {
		t.Fatal(err)
	}
	res, err := db.Exec(`INSERT INTO videos (fingerprint, library_id, path, size, mod_time, title, added_at)
		VALUES ('fp', 1, ?, 1, 1, 't', 1)`, rel)
	if err != nil {
		t.Fatal(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return db, id
}

type savedInfo struct {
	duration, width, height           sql.NullInt64
	videoCodec, audioCodec, container sql.NullString
	pixelFormat                       sql.NullString
}

func info(t *testing.T, db *sql.DB, id int64) savedInfo {
	t.Helper()
	var s savedInfo
	err := db.QueryRow(`SELECT duration, width, height, video_codec, audio_codec, container, pixel_format
		FROM videos WHERE id = ?`, id).
		Scan(&s.duration, &s.width, &s.height, &s.videoCodec, &s.audioCodec, &s.container, &s.pixelFormat)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func fakeRun(output string, err error, gotArgs *[]string) runFunc {
	return func(_ context.Context, _ string, args ...string) ([]byte, error) {
		*gotArgs = args
		return []byte(output), err
	}
}

func TestProberSavesWhatFFprobeFound(t *testing.T) {
	db, id := catalog(t, "/videos", "Viaggi/mare: estate.mp4")
	var args []string
	p := NewProber(db, "ffprobe")
	p.run = fakeRun(`{"format":{"format_name":"matroska,webm","duration":"90.4"},
		"streams":[{"codec_type":"video","codec_name":"vp9","width":1280,"height":720,"pix_fmt":"yuv420p10le"},
		{"codec_type":"audio","codec_name":"opus"}]}`, nil, &args)

	if err := p.Handle(context.Background(), id); err != nil {
		t.Fatal(err)
	}

	if last := args[len(args)-1]; last != "file:"+filepath.Join("/videos", "Viaggi", "mare: estate.mp4") {
		t.Errorf("ffprobe asked to read %q", last)
	}
	got := info(t, db, id)
	if got.duration.Int64 != 90 || got.width.Int64 != 1280 || got.height.Int64 != 720 ||
		got.videoCodec.String != "vp9" || got.audioCodec.String != "opus" || got.container.String != "matroska,webm" ||
		got.pixelFormat.String != "yuv420p10le" {
		t.Errorf("saved %+v", got)
	}
	// What the reading makes possible is asked for next.
	var kinds string
	if err := db.QueryRow(`SELECT group_concat(kind, ' ') FROM (SELECT kind FROM jobs
		WHERE video_id = ? AND state = 'pending' ORDER BY kind)`, id).Scan(&kinds); err != nil {
		t.Fatal(err)
	}
	if kinds != "clip convert cover preview tracks" {
		t.Errorf("jobs asked for: %q", kinds)
	}
}

// TestProberLeavesOutVideosTooShort: once its length is known, a video of
// the folders shorter than the administrator's minimum is not shown.
func TestProberLeavesOutVideosTooShort(t *testing.T) {
	db, id := catalog(t, "/videos", "anteprima.mp4")
	if _, err := db.Exec(`INSERT INTO settings (key, value) VALUES ('library.min_duration', '20')`); err != nil {
		t.Fatal(err)
	}
	var args []string
	p := NewProber(db, "ffprobe")
	p.run = fakeRun(`{"format":{"format_name":"mov,mp4,m4a,3gp,3g2,mj2","duration":"10.0"},
		"streams":[{"codec_type":"video","codec_name":"h264","width":640,"height":360,"pix_fmt":"yuv420p"}]}`, nil, &args)
	if err := p.Handle(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	var visible bool
	if err := db.QueryRow(`SELECT visible FROM videos WHERE id = ?`, id).Scan(&visible); err != nil {
		t.Fatal(err)
	}
	if visible {
		t.Error("a 10 s video is shown with a minimum of 20 s")
	}
}

func TestProberFailures(t *testing.T) {
	tests := []struct {
		name      string
		output    string
		runErr    error
		permanent bool
	}{
		{"not a video", `{"streams":[{"codec_type":"audio","codec_name":"mp3"}]}`, nil, true},
		{"ffprobe failed", "", errors.New("exit status 1: Invalid data"), false},
		{"unreadable answer", "garbage", nil, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, id := catalog(t, "/videos", "a.mp4")
			var args []string
			p := NewProber(db, "ffprobe")
			p.run = fakeRun(tt.output, tt.runErr, &args)
			err := p.Handle(context.Background(), id)
			if err == nil {
				t.Fatal("no error")
			}
			if got := errors.Is(err, jobs.ErrPermanent); got != tt.permanent {
				t.Errorf("permanent = %v, want %v (error: %v)", got, tt.permanent, err)
			}
			if got := info(t, db, id); got.duration.Valid {
				t.Errorf("info saved after a failure: %+v", got)
			}
		})
	}
}

func TestProberMissingAndDeletedVideos(t *testing.T) {
	db, id := catalog(t, "/videos", "a.mp4")
	var args []string
	p := NewProber(db, "ffprobe")
	p.run = fakeRun("{}", nil, &args)

	if _, err := db.Exec(`UPDATE videos SET missing_since = 1 WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	err := p.Handle(context.Background(), id)
	if !errors.Is(err, errVideoMissing) || errors.Is(err, jobs.ErrPermanent) {
		t.Errorf("missing video: error = %v, want a temporary errVideoMissing", err)
	}

	err = p.Handle(context.Background(), id+100)
	if !errors.Is(err, errVideoGone) || !errors.Is(err, jobs.ErrPermanent) {
		t.Errorf("deleted video: error = %v, want a permanent errVideoGone", err)
	}
	if args != nil {
		t.Error("ffprobe ran for a video that is not there")
	}
}

func TestProberDoesNotSaveOverNewContent(t *testing.T) {
	db, id := catalog(t, "/videos", "a.mp4")
	p := NewProber(db, "ffprobe")
	p.run = func(context.Context, string, ...string) ([]byte, error) {
		// The file is replaced while ffprobe reads the old one.
		if _, err := db.Exec(`UPDATE videos SET fingerprint = 'new' WHERE id = ?`, id); err != nil {
			t.Fatal(err)
		}
		return []byte(`{"streams":[{"codec_type":"video","codec_name":"h264","width":2,"height":2}]}`), nil
	}
	if err := p.Handle(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	if got := info(t, db, id); got.width.Valid {
		t.Errorf("info of the old file saved on the new one: %+v", got)
	}
}

// TestProberWithRealFFprobe makes a tiny video with ffmpeg and reads it
// with the real ffprobe. It is skipped where ffmpeg is not installed.
func TestProberWithRealFFprobe(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg not installed")
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("ffprobe not installed")
	}
	root := t.TempDir()
	name := filepath.Join(root, "prova: video.mp4")
	if _, err := run(context.Background(), ffmpeg, "-v", "error",
		"-f", "lavfi", "-i", "testsrc=duration=2:size=160x90:rate=10",
		"-pix_fmt", "yuv420p", "file:"+name); err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(name)
	if err != nil {
		t.Fatal(err)
	}

	db, id := catalog(t, root, "prova: video.mp4")
	if err := NewProber(db, ffprobe).Handle(context.Background(), id); err != nil {
		t.Fatal(err)
	}
	got := info(t, db, id)
	if got.duration.Int64 != 2 || got.width.Int64 != 160 || got.height.Int64 != 90 {
		t.Errorf("saved %+v, want 2 s at 160x90", got)
	}

	after, err := os.Stat(name)
	if err != nil {
		t.Fatal(err)
	}
	if !after.ModTime().Equal(before.ModTime()) || after.Size() != before.Size() {
		t.Error("reading the video changed the file")
	}
}

// A video whose file is away (a disk unplugged) waits for it, without
// using up its tries; once the file is back the job runs.
func TestMissingFileWaits(t *testing.T) {
	dir := t.TempDir()
	db, id := catalog(t, dir, "a.mp4")
	saved := fileThere
	t.Cleanup(func() { fileThere = saved })
	fileThere = func(path string) error {
		_, err := os.Stat(path)
		return err
	}
	var args []string
	p := NewProber(db, "ffprobe")
	p.run = fakeRun(`{"format":{"duration":"10"},"streams":[{"codec_type":"video","codec_name":"h264","width":640,"height":360}]}`, nil, &args)

	err := p.Handle(context.Background(), id)
	var later *jobs.LaterError
	if !errors.As(err, &later) || errors.Is(err, jobs.ErrPermanent) {
		t.Fatalf("file away: error = %v, want a job that waits", err)
	}
	if wait := time.Until(later.Until); wait < missingWait-time.Minute || wait > missingWait {
		t.Errorf("waits %s, want about %s", wait, missingWait)
	}
	if args != nil {
		t.Error("ffprobe ran for a file that is not there")
	}

	if err := os.WriteFile(filepath.Join(dir, "a.mp4"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := p.Handle(context.Background(), id); err != nil {
		t.Fatalf("file back: %v", err)
	}
}
