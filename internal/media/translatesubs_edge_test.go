package media

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/FranzGra/FranzPLAY/internal/video"
)

func TestKeepStyle(t *testing.T) {
	for in, want := range map[string]string{
		"plain":                                    "plain",
		"<i>corsivo</i>":                           "<i>corsivo</i>",
		"<I>MAIUSCOLO</I> <B>b</B> <u>u</u>":       "<i>MAIUSCOLO</i> <b>b</b> <u>u</u>",
		`<font color="#ffff00">Giallo</font>`:      "Giallo",
		`{\an8}In alto`:                            "In alto",
		`{\an8}{\pos(10,20)}<font face=x>A</font>`: "A",
		"<c.yellow>c</c> <v Mario>v</v>":           "c v",
		"2 < 3 e 4 > 1":                            "2 < 3 e 4 > 1",
		"<3 cuore":                                 "<3 cuore",
		"{senza barra}":                            "{senza barra}",
	} {
		if got := video.KeepStyle(in); got != want {
			t.Errorf("keepStyle(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestFileSubtitleChoice: the subtitle read next to a video is the one in
// the language asked, the full one before the one for the forced parts,
// whatever its encoding.
func TestFileSubtitleChoice(t *testing.T) {
	dir := t.TempDir()
	videoFile := filepath.Join(dir, "Il film è qui.mkv")
	write := func(name, data string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(data), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("Il film è qui.it.forced.srt", "1\n00:00:01,000 --> 00:00:02,000\nSolo le parti forzate\n")
	write("Il film è qui.it.srt", "1\r\n00:00:01,000 --> 00:00:02,000\r\nCos\xec \xe8\r\n")
	write("Il film è qui.en.vtt", "WEBVTT\n\n00:01.000 --> 00:02.000\nHello\n")
	write("Altro film.fr.srt", "1\n00:00:01,000 --> 00:00:02,000\nBonjour\n")

	got, err := fileSubtitle(videoFile, "it")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, "Così è") || strings.Contains(got, "forzate") {
		t.Errorf("it: %q, want the full Windows-1252 subtitle", got)
	}
	if got, err := fileSubtitle(videoFile, "en"); err != nil || !strings.Contains(got, "Hello") {
		t.Errorf("en: %q, %v", got, err)
	}
	if _, err := fileSubtitle(videoFile, "fr"); !errors.Is(err, errNoSource) {
		t.Errorf("fr of another video: err = %v, want errNoSource", err)
	}
	if _, err := fileSubtitle(filepath.Join(dir, "gone", "x.mp4"), "it"); !errors.Is(err, errNoSource) {
		t.Errorf("folder gone: err = %v, want errNoSource", err)
	}

	// Only the forced one: it is used.
	if err := os.Remove(filepath.Join(dir, "Il film è qui.it.srt")); err != nil {
		t.Fatal(err)
	}
	if got, err := fileSubtitle(videoFile, "it"); err != nil || !strings.Contains(got, "forzate") {
		t.Errorf("only forced: %q, %v", got, err)
	}
}
