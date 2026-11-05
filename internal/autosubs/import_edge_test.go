package autosubs

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"unicode/utf16"
)

// utf16File writes text as UTF-16 with its byte order mark, as Windows
// Notepad saves "Unicode" files.
func utf16File(text string, bigEndian bool) []byte {
	units := utf16.Encode([]rune(text))
	out := []byte{0xFF, 0xFE}
	if bigEndian {
		out = []byte{0xFE, 0xFF}
	}
	for _, u := range units {
		if bigEndian {
			out = append(out, byte(u>>8), byte(u))
		} else {
			out = append(out, byte(u), byte(u>>8))
		}
	}
	return out
}

// TestImportedVTTEncodings: the same subtitles, saved by different
// programs, are imported the same.
func TestImportedVTTEncodings(t *testing.T) {
	const body = "1\n00:00:01,000 --> 00:00:02,500\nPerché sì\n"
	const want = "WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nPerché sì\n"
	for name, data := range map[string][]byte{
		"utf-8":                {},
		"utf-8 crlf":           []byte(strings.ReplaceAll(body, "\n", "\r\n")),
		"utf-8 bom":            []byte("\xEF\xBB\xBF" + body),
		"utf-8 bom crlf":       []byte("\xEF\xBB\xBF" + strings.ReplaceAll(body, "\n", "\r\n")),
		"old mac":              []byte(strings.ReplaceAll(body, "\n", "\r")),
		"windows-1252":         []byte(strings.NewReplacer("é", "\xe9", "ì", "\xec").Replace(body)),
		"utf-16 le":            utf16File(body, false),
		"utf-16 be":            utf16File(strings.ReplaceAll(body, "\n", "\r\n"), true),
		"blank lines first":    []byte("\r\n\r\n" + body),
		"vtt with crlf":        []byte("WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.500\r\nPerché sì\r\n"),
		"vtt with header text": []byte("WEBVTT - Kind: captions\n\nNOTE da un altro programma\n\n00:01.000 --> 00:02.500 line:90%\nPerché sì\n"),
	} {
		if len(data) == 0 {
			data = []byte(body)
		}
		got, err := importedVTT(data)
		if err != nil || got != want {
			t.Errorf("%s: %q, %v; want %q", name, got, err, want)
		}
	}
}

func TestImportedVTTRefusals(t *testing.T) {
	for name, tc := range map[string]struct {
		data []byte
		want error
	}{
		"empty":               {nil, errImportFormat},
		"only spaces":         {[]byte(" \r\n\t\n"), errImportFormat},
		"nul in utf-8":        {[]byte("1\n00:00:01,000 --> 00:00:02,000\nA\x00B\n"), errImportNotText},
		"escape character":    {[]byte("1\n00:00:01,000 --> 00:00:02,000\n\x1b[31mrosso\n"), errImportNotText},
		"delete character":    {[]byte("1\n00:00:01,000 --> 00:00:02,000\nA\x7fB\n"), errImportNotText},
		"control in utf-16":   {utf16File("1\n00:00:01,000 --> 00:00:02,000\nA\x01B\n", false), errImportNotText},
		"a picture":           {[]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"), errImportNotText},
		"malformed times":     {[]byte("1\n00:00:01 --> 00:00:02\nSenza millesimi\n"), errImportNoCues},
		"arrow without times": {[]byte("A --> B\n"), errImportNoCues},
		"vtt header only":     {[]byte("WEBVTT\n"), errImportNoCues},
		"vtt with srt times":  {[]byte("WEBVTT\n\n00:00:01,000 --> 00:00:02,000\nVirgole\n"), errImportNoCues},
		"sub (microdvd)":      {[]byte("{1}{25}Ciao\n"), errImportFormat},
	} {
		if _, err := importedVTT(tc.data); !errors.Is(err, tc.want) {
			t.Errorf("%s: err = %v, want %v", name, err, tc.want)
		}
	}
}

// TestImportedVTTKeepsOnlyTheTextOfTheCues: what comes from a file is
// written again, so nothing in it reaches the player as markup.
func TestImportedVTTKeepsOnlyTheTextOfTheCues(t *testing.T) {
	data := "WEBVTT\n\nSTYLE\n::cue { color: red }\n\n" +
		"00:00:01.000 --> 00:00:02.000\n<c.yellow>Giallo</c> <v Mario>Ciao</v> <i>corsivo</i> <img src=x onerror=alert(1)>\n"
	got, err := importedVTT([]byte(data))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(got, "STYLE") || strings.Contains(got, "<c") || strings.Contains(got, "<img") || strings.Contains(got, "<v") {
		t.Errorf("markup left in %q", got)
	}
	if !strings.Contains(got, "<i>corsivo</i>") {
		t.Errorf("italics lost in %q", got)
	}
}

// TestImportedVTTFontTags: many Italian .srt files colour their lines with
// <font>. The colour can go, but the words must not show the tag itself.
func TestImportedVTTFontTags(t *testing.T) {
	got, err := importedVTT([]byte("1\n00:00:01,000 --> 00:00:02,000\n{\\an8}<font color=\"#ffff00\">Ciao</font>\n"))
	if err != nil {
		t.Fatal(err)
	}
	if want := "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nCiao\n"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

// TestImportedVTTBlankLinesWithSpaces: a line of spaces between two cues,
// common in hand-edited files, must not swallow the second cue.
func TestImportedVTTBlankLinesWithSpaces(t *testing.T) {
	got, err := importedVTT([]byte("1\r\n00:00:01,000 --> 00:00:02,000\r\nUno\r\n \r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nDue\r\n"))
	if err != nil {
		t.Fatal(err)
	}
	if want := "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nUno\n\n00:00:03.000 --> 00:00:04.000\nDue\n"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

// bigImport is a valid .srt of exactly size bytes.
func bigImport(size int) string {
	var sb strings.Builder
	for i := 0; ; i++ {
		cue := fmt.Sprintf("%d\n00:%02d:%02d,000 --> 00:%02d:%02d,500\nBattuta %d\n\n", i+1, i/60%60, i%60, i/60%60, i%60, i)
		if sb.Len()+len(cue) > size {
			break
		}
		sb.WriteString(cue)
	}
	return sb.String() + strings.Repeat(" ", size-sb.Len())
}

func TestImportSizeLimit(t *testing.T) {
	s := newSite(t)
	id := s.addVideo(t, "lungo.mp4", "Lungo")
	path := "/api/admin/subtitles/" + strconv.FormatInt(id, 10) + "/import/"
	if got := len(bigImport(maxImport)); got != maxImport {
		t.Fatalf("file of %d bytes, want %d", got, maxImport)
	}
	s.do(t, "PUT", path+"en", bigImport(maxImport), http.StatusNoContent)
	s.do(t, "PUT", path+"it", bigImport(maxImport)+"x", http.StatusRequestEntityTooLarge)
}

// TestImportLanguageInTheAddress: the language names the file, so only
// two or three small letters are accepted: nothing can climb out of the
// folder or make two names for one language.
func TestImportLanguageInTheAddress(t *testing.T) {
	s := newSite(t)
	id := s.addVideo(t, "mare.mp4", "Mare")
	path := "/api/admin/subtitles/" + strconv.FormatInt(id, 10) + "/import/"
	for _, lang := range []string{"IT", "it-IT", "it_IT", "i", "itaa", "%2e%2e", "..%5c..%5cx", "it%00", "%C3%A8", "1t"} {
		s.do(t, "PUT", path+lang, srt, http.StatusBadRequest)
	}
	s.do(t, "PUT", path+"ita", srt, http.StatusNoContent)
	s.do(t, "PUT", "/api/admin/subtitles/abc/import/it", srt, http.StatusNotFound)
	s.do(t, "PUT", "/api/admin/subtitles/-1/import/it", srt, http.StatusNotFound)

	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM auto_subtitles`).Scan(&n); err != nil || n != 1 {
		t.Errorf("rows = %d, %v; want only ita", n, err)
	}
}

// BenchmarkImportedVTT measures importing a film's .srt.
func BenchmarkImportedVTT(b *testing.B) {
	data := []byte(bigImport(300 << 10))
	b.SetBytes(int64(len(data)))
	for b.Loop() {
		if _, err := importedVTT(data); err != nil {
			b.Fatal(err)
		}
	}
}
