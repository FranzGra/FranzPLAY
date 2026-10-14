package library

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// content returns n bytes that differ from one position to the next.
func content(n int) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(i * 7 % 251)
	}
	return b
}

func fp(t *testing.T, b []byte) string {
	t.Helper()
	got, err := fingerprintReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func TestFingerprintIsStableAndVersioned(t *testing.T) {
	b := content(1 << 20)
	first, second := fp(t, b), fp(t, b)
	if first != second {
		t.Errorf("same content, different fingerprints: %s and %s", first, second)
	}
	if !strings.HasPrefix(first, fingerprintVersion) {
		t.Errorf("fingerprint %q does not start with %q", first, fingerprintVersion)
	}
}

func TestFingerprintSeesChanges(t *testing.T) {
	big := content(1 << 20)
	base := fp(t, big)
	tests := map[string]func([]byte) []byte{
		"change at the start":  func(b []byte) []byte { b[0]++; return b },
		"change in the middle": func(b []byte) []byte { b[len(b)/2]++; return b },
		"change at the end":    func(b []byte) []byte { b[len(b)-1]++; return b },
		"one byte longer":      func(b []byte) []byte { return append(b, 0) },
	}
	for name, change := range tests {
		t.Run(name, func(t *testing.T) {
			if got := fp(t, change(bytes.Clone(big))); got == base {
				t.Error("fingerprint did not change")
			}
		})
	}
}

func TestFingerprintReadsSmallFilesWhole(t *testing.T) {
	// 150 KiB is read whole: a change anywhere must be seen.
	small := content(150 << 10)
	base := fp(t, small)
	changed := bytes.Clone(small)
	changed[100<<10]++
	if fp(t, changed) == base {
		t.Error("change inside a small file not seen")
	}
}

func TestFingerprintEmptyFile(t *testing.T) {
	if got := fp(t, nil); !strings.HasPrefix(got, fingerprintVersion) {
		t.Errorf("fingerprint of empty content = %q", got)
	}
}

func TestFingerprintFileShorterThanItsSize(t *testing.T) {
	_, err := fingerprintReader(bytes.NewReader(content(10)), 1<<20)
	if !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Errorf("error = %v, want io.ErrUnexpectedEOF", err)
	}
}

func TestFingerprintFile(t *testing.T) {
	name := filepath.Join(t.TempDir(), "video.mp4")
	b := content(500 << 10)
	if err := os.WriteFile(name, b, 0o600); err != nil {
		t.Fatal(err)
	}
	dir := os.DirFS(filepath.Dir(name))
	got, err := Fingerprint(dir, "video.mp4")
	if err != nil {
		t.Fatal(err)
	}
	if want := fp(t, b); got != want {
		t.Errorf("Fingerprint(file) = %s, want %s", got, want)
	}
	if _, err := Fingerprint(dir, "nope.mp4"); err == nil {
		t.Error("fingerprint of a missing file: no error")
	}
}
