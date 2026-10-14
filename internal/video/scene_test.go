package video

import (
	"bytes"
	"encoding/binary"
	"errors"
	"strings"
	"testing"
)

func TestOSHash(t *testing.T) {
	// Zeros add nothing: the hash is the size.
	zeros := make([]byte, 200<<10)
	if got, err := OSHash(bytes.NewReader(zeros), int64(len(zeros))); err != nil || got != "0000000000032000" {
		t.Errorf("zeros = %q, %v", got, err)
	}

	// The first and last 64 KiB count; the middle does not.
	file := make([]byte, 200<<10)
	binary.LittleEndian.PutUint64(file[0:], 1)
	binary.LittleEndian.PutUint64(file[100<<10:], 1000) // in the middle
	binary.LittleEndian.PutUint64(file[len(file)-8:], 0x10)
	if got, err := OSHash(bytes.NewReader(file), int64(len(file))); err != nil || got != "0000000000032011" {
		t.Errorf("file = %q, %v", got, err)
	}

	// The sum wraps around, like in every other program that computes it:
	// 16384 numbers that are all "-1", plus the size 0x20000.
	full := bytes.Repeat([]byte{0xff}, 128<<10)
	if got, err := OSHash(bytes.NewReader(full), int64(len(full))); err != nil || got != "000000000001c000" {
		t.Errorf("full = %q, %v", got, err)
	}

	// A file smaller than 64 KiB is read whole, twice.
	small := make([]byte, 16)
	binary.LittleEndian.PutUint64(small[8:], 3)
	if got, err := OSHash(bytes.NewReader(small), int64(len(small))); err != nil || got != "0000000000000016" {
		t.Errorf("small = %q, %v", got, err)
	}

	if _, err := OSHash(bytes.NewReader(nil), 0); err == nil {
		t.Error("empty file: no error")
	}
	if _, err := OSHash(bytes.NewReader(small), 1<<20); err == nil {
		t.Error("file shorter than its size: no error")
	}
}

func TestParseTPDBScenes(t *testing.T) {
	tests := []struct {
		name string
		data string
		want Scene
		ok   bool
	}{
		{
			name: "one scene: the site is the author, the wide picture first",
			data: `{"data": [{"id": "abc", "title": "Una\nscena", "description": "Prima riga.\r\nSeconda.",
				"date": "2021-03-15", "site": {"name": "Uno Studio"}, "performers": [{"name": "Qualcuno"}],
				"image": "https://cdn.theporndb.net/image.jpg",
				"background": {"full": "https://cdn.theporndb.net/full.jpg", "large": "https://cdn.theporndb.net/large.jpg"},
				"posters": {"large": "https://cdn.theporndb.net/poster.jpg"}}]}`,
			want: Scene{Details: Details{Title: "Una scena", Description: "Prima riga.\nSeconda.", Author: "Uno Studio",
				Date: "2021-03-15"}, Picture: "https://cdn.theporndb.net/large.jpg",
				Thumb: "https://cdn.theporndb.net/image.jpg"},
			ok: true,
		},
		{
			name: "its hashes have this one",
			data: `{"data": [{"title": "A", "hashes": [{"hash": "0000000000000001", "type": "PHASH"},
				{"hash": "00000000000ABCDE", "type": "OSHASH"}], "image": "https://metadataapi.net/a.png"}]}`,
			want: Scene{Details: Details{Title: "A"}, Picture: "https://metadataapi.net/a.png",
				Thumb: "https://metadataapi.net/a.png"},
			ok: true,
		},
		{
			name: "its hashes do not have this one",
			data: `{"data": [{"title": "A", "hashes": [{"hash": "0000000000000001"}]}]}`,
		},
		{
			name: "more than one scene is not sure",
			data: `{"data": [{"title": "A"}, {"title": "B"}]}`,
		},
		{
			name: "no scene",
			data: `{"data": []}`,
		},
		{
			name: "pictures elsewhere are not used",
			data: `{"data": [{"title": "A", "image": "http://cdn.theporndb.net/a.jpg",
				"background": {"large": "https://evil.example/theporndb.net.jpg"},
				"posters": {"large": "https://user@cdn.theporndb.net:8443/p.jpg"}}]}`,
			want: Scene{Details: Details{Title: "A"}},
			ok:   true,
		},
	}
	for _, tt := range tests {
		got, ok, err := ParseTPDBScenes([]byte(tt.data), "00000000000abcde")
		if err != nil {
			t.Fatalf("%s: %v", tt.name, err)
		}
		if got != tt.want || ok != tt.ok {
			t.Errorf("%s:\n got %+v, %v\nwant %+v, %v", tt.name, got, ok, tt.want, tt.ok)
		}
	}
	if _, _, err := ParseTPDBScenes([]byte(`<html>`), "x"); !errors.Is(err, ErrBadDetails) {
		t.Errorf("error = %v, want ErrBadDetails", err)
	}
}

func TestParseTPDBSearch(t *testing.T) {
	got, err := ParseTPDBSearch([]byte(`{"data": [
		{"title": "Prima", "date": "2020-01-02", "site": {"name": "Studio"},
			"background": {"large": "https://cdn.theporndb.net/l.jpg", "small": "https://cdn.theporndb.net/s.jpg"}},
		{"title": "Seconda", "image": "https://evil.example/x.jpg"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	want := []Scene{
		{Details: Details{Title: "Prima", Author: "Studio", Date: "2020-01-02"},
			Picture: "https://cdn.theporndb.net/l.jpg", Thumb: "https://cdn.theporndb.net/s.jpg"},
		{Details: Details{Title: "Seconda"}},
	}
	if len(got) != len(want) {
		t.Fatalf("ParseTPDBSearch = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("scene %d:\n got %+v\nwant %+v", i, got[i], want[i])
		}
	}

	many := `{"data": [` + strings.Repeat(`{"title": "x"},`, 20) + `{"title": "x"}]}`
	if got, err := ParseTPDBSearch([]byte(many)); err != nil || len(got) != maxSearchHits {
		t.Errorf("a long answer gives %d scenes, %v; want %d", len(got), err, maxSearchHits)
	}
	if _, err := ParseTPDBSearch([]byte(`<html>`)); !errors.Is(err, ErrBadDetails) {
		t.Errorf("error = %v, want ErrBadDetails", err)
	}
}
