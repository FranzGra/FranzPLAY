package catalog

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"reflect"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/server"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// fakeRemuxer pretends to be ffmpeg: key frames every 5 seconds, and a
// "video" that names the sound track and the time.
type fakeRemuxer struct {
	err      error
	file     string
	audio    video.EmbeddedAudio
	at       float64
	streamed bool
}

func (f *fakeRemuxer) StartOf(_ context.Context, file string, at float64) (float64, error) {
	f.file = file
	return float64(int(at) / 5 * 5), nil
}

func (f *fakeRemuxer) Stream(_ context.Context, w io.Writer, file string, audio video.EmbeddedAudio, at float64) error {
	f.file, f.audio, f.at, f.streamed = file, audio, at, true
	if f.err != nil {
		return f.err
	}
	_, err := io.WriteString(w, "mp4 bytes")
	return err
}

// withAudio is a site with the sound track routes and a film with an
// Italian and an English sound track.
func withAudio(t *testing.T, remux Remuxer) *site {
	t.Helper()
	s := newSite(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	ui := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "ui") })
	s.handler = server.New("test", logger, ui, Routes(s.db, s.dataDir, logger), AudioRoutes(s.db, remux, logger))
	id := s.addVideo(t, "film.mkv", "film", "", 1, true)
	if _, err := s.db.Exec(`INSERT INTO video_audio (video_id, stream, lang, title, codec, channels, is_default) VALUES
		(?, 1, 'ita', '', 'ac3', 6, 1), (?, 2, 'eng', 'Commento', 'aac', 2, 0)`, id, id); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestAudioTracks(t *testing.T) {
	s := withAudio(t, &fakeRemuxer{})
	got := decode[[]audioTrack](t, s.get(t, "/api/videos/1/audio"))
	want := []audioTrack{
		{Stream: 1, Lang: "it", Label: "Italiano", Default: true},
		{Stream: 2, Lang: "en", Label: "Inglese · Commento"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("tracks = %+v, want %+v", got, want)
	}

	// One track only, or no ffmpeg: nothing to choose.
	one := s.addVideo(t, "mare.mp4", "sea", "", 1, true)
	if _, err := s.db.Exec(`INSERT INTO video_audio (video_id, stream, lang, title, codec, channels, is_default)
		VALUES (?, 1, 'ita', '', 'aac', 2, 1)`, one); err != nil {
		t.Fatal(err)
	}
	if body := s.get(t, "/api/videos/2/audio").Body.String(); body != "[]\n" {
		t.Errorf("one track: %q, want an empty list", body)
	}
	if body := withAudio(t, nil).get(t, "/api/videos/1/audio").Body.String(); body != "[]\n" {
		t.Errorf("without ffmpeg: %q, want an empty list", body)
	}
	if rec := s.get(t, "/api/videos/9/audio"); rec.Code != http.StatusNotFound {
		t.Errorf("unknown video: %d, want 404", rec.Code)
	}
}

func TestPlayWithAnotherSoundTrack(t *testing.T) {
	fake := &fakeRemuxer{}
	s := withAudio(t, fake)
	start := decode[audioStart](t, s.get(t, "/api/videos/1/audio/2?at=13.5"))
	if start != (audioStart{Start: 10, Src: "/api/videos/1/audio/2/stream?at=13.5"}) {
		t.Fatalf("start = %+v", start)
	}
	rec := s.get(t, start.Src)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "video/mp4" || rec.Body.String() != "mp4 bytes" {
		t.Fatalf("stream: %d %q %q", rec.Code, rec.Header().Get("Content-Type"), rec.Body)
	}
	if fake.audio.Stream != 2 || fake.audio.Codec != "aac" || fake.at != 13.5 || fake.file == "" {
		t.Errorf("ffmpeg asked for %+v from %v of %q", fake.audio, fake.at, fake.file)
	}
}

func TestPlayWithAnotherSoundTrackRefused(t *testing.T) {
	s := withAudio(t, &fakeRemuxer{})
	tests := []struct {
		target string
		want   int
	}{
		{"/api/videos/1/audio/3?at=1", http.StatusNotFound},      // no such track
		{"/api/videos/1/audio/x?at=1", http.StatusNotFound},      // not a track
		{"/api/videos/9/audio/1?at=1", http.StatusNotFound},      // no such video
		{"/api/videos/1/audio/1?at=-1", http.StatusBadRequest},   // before the start
		{"/api/videos/1/audio/1?at=NaN", http.StatusBadRequest},  // not a number
		{"/api/videos/1/audio/1?at=9e99", http.StatusBadRequest}, // far too late
		{"/api/videos/1/audio/1/stream?at=x", http.StatusBadRequest},
	}
	for _, tt := range tests {
		if rec := s.get(t, tt.target); rec.Code != tt.want {
			t.Errorf("%s: %d, want %d", tt.target, rec.Code, tt.want)
		}
	}
	if rec := withAudio(t, nil).get(t, "/api/videos/1/audio/1?at=1"); rec.Code != http.StatusNotFound {
		t.Errorf("without ffmpeg: %d, want 404", rec.Code)
	}
	// A hidden video plays no more.
	if _, err := s.db.Exec(`UPDATE videos SET hidden_at = 1 WHERE id = 1`); err != nil {
		t.Fatal(err)
	}
	if rec := s.get(t, "/api/videos/1/audio/1/stream"); rec.Code != http.StatusNotFound {
		t.Errorf("hidden video: %d, want 404", rec.Code)
	}
}

func TestPlayWithAnotherSoundTrackWhenBusy(t *testing.T) {
	s := withAudio(t, &fakeRemuxer{err: media.ErrBusy})
	rec := s.get(t, "/api/videos/1/audio/2/stream")
	if rec.Code != http.StatusServiceUnavailable || rec.Header().Get("Retry-After") == "" {
		t.Errorf("busy: %d, Retry-After %q", rec.Code, rec.Header().Get("Retry-After"))
	}
	s = withAudio(t, &fakeRemuxer{err: errors.New("broken file")})
	if rec := s.get(t, "/api/videos/1/audio/2/stream"); rec.Code != http.StatusInternalServerError {
		t.Errorf("ffmpeg failed: %d, want 500", rec.Code)
	}
}
