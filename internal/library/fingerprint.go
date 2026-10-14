package library

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
)

// fingerprintVersion starts every fingerprint, so the method can change
// one day without confusing old and new fingerprints.
const fingerprintVersion = "v1:"

// sampleSize is how much is read from the start, middle and end of a file.
const sampleSize = 64 << 10 // 64 KiB

// Fingerprint identifies a file by its content.
//
// Reading a whole video would take minutes on a Raspberry Pi, so only three
// samples are read (start, middle, end) together with the exact size: at
// most 192 KiB per file. Two different videos with the same size and the
// same bytes in all three places do not happen in practice.
//
// The file is read through an fs.FS, which has no way to write: the video
// folder cannot be changed from here even by mistake.
func Fingerprint(fsys fs.FS, name string) (string, error) {
	file, err := fsys.Open(name)
	if err != nil {
		return "", fmt.Errorf("fingerprint: %w", err)
	}
	defer file.Close() //nolint:errcheck // read-only file: closing cannot lose data

	info, err := file.Stat()
	if err != nil {
		return "", fmt.Errorf("fingerprint %s: %w", name, err)
	}
	r, ok := file.(io.ReaderAt)
	if !ok {
		return "", fmt.Errorf("fingerprint %s: file cannot be read at an offset", name)
	}
	return fingerprintReader(r, info.Size())
}

// fingerprintReader does the work of Fingerprint on any readable content.
func fingerprintReader(r io.ReaderAt, size int64) (string, error) {
	h := sha256.New()
	var sizeBytes [8]byte
	binary.BigEndian.PutUint64(sizeBytes[:], uint64(size)) // a file size is never negative
	h.Write(sizeBytes[:])

	for _, s := range samples(size) {
		n, err := io.Copy(h, io.NewSectionReader(r, s.offset, s.length))
		if err != nil {
			return "", fmt.Errorf("fingerprint: read at %d: %w", s.offset, err)
		}
		if n != s.length {
			return "", fmt.Errorf("fingerprint: file shorter than expected at %d: %w", s.offset, io.ErrUnexpectedEOF)
		}
	}
	return fingerprintVersion + hex.EncodeToString(h.Sum(nil)), nil
}

// sample is a piece of the file that goes into the fingerprint.
type sample struct {
	offset, length int64
}

// samples returns the pieces to read. A small file is read whole.
func samples(size int64) []sample {
	if size <= 3*sampleSize {
		return []sample{{0, size}}
	}
	return []sample{
		{0, sampleSize},
		{size/2 - sampleSize/2, sampleSize},
		{size - sampleSize, sampleSize},
	}
}
