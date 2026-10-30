package video

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
)

// osHashChunk is how much OSHash reads from the start and from the end.
const osHashChunk = 64 << 10

// OSHash computes the "OpenSubtitles hash" of a file: its size plus the
// sum of its first and last 64 KiB, read as 64-bit numbers. It is the
// fingerprint ThePornDB, Stash and Plex use to know a video by its
// content. Only 128 KiB are read, through r, which cannot write.
func OSHash(r io.ReaderAt, size int64) (string, error) {
	if size <= 0 {
		return "", errors.New("oshash: empty file")
	}
	chunk := min(size, osHashChunk)
	sum := uint64(size)
	for _, offset := range []int64{0, size - chunk} {
		buf := make([]byte, chunk)
		if _, err := r.ReadAt(buf, offset); err != nil {
			return "", fmt.Errorf("oshash: read at %d: %w", offset, err)
		}
		for i := 0; i+8 <= len(buf); i += 8 {
			sum += binary.LittleEndian.Uint64(buf[i:])
		}
	}
	return fmt.Sprintf("%016x", sum), nil
}

// Scene is what ThePornDB says about a video.
type Scene struct {
	Details
	Picture string // the address of its best picture; "" if none
	Thumb   string // the address of a small picture, for a list; "" if none
}

// tpdbScenes are the fields of ThePornDB's answer to a search FranzPLAY uses.
type tpdbScenes struct {
	Data []tpdbScene `json:"data"`
}

type tpdbScene struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Date        string `json:"date"`
	Site        struct {
		Name string `json:"name"`
	} `json:"site"`
	Image      string `json:"image"`
	Background struct {
		Large  string `json:"large"`
		Medium string `json:"medium"`
		Small  string `json:"small"`
	} `json:"background"`
	Posters struct {
		Large string `json:"large"`
	} `json:"posters"`
	Hashes []struct {
		Hash string `json:"hash"`
	} `json:"hashes"`
}

// ParseTPDBScenes reads ThePornDB's answer to a search by hash. ok is
// true only when it found exactly one scene, and that scene, when it
// lists its hashes, has this one: anything less sure is no scene at all.
// The author of a scene is the site that made it.
func ParseTPDBScenes(data []byte, hash string) (_ Scene, ok bool, err error) {
	var in tpdbScenes
	if err := json.Unmarshal(data, &in); err != nil {
		return Scene{}, false, fmt.Errorf("%w: %w", ErrBadDetails, err)
	}
	if len(in.Data) != 1 {
		return Scene{}, false, nil
	}
	s := in.Data[0]
	if len(s.Hashes) > 0 && !hasHash(s, hash) {
		return Scene{}, false, nil
	}
	return sceneOf(s), true, nil
}

// maxSearchHits is how many answers of a search are kept: enough to find
// the right one among the first, few enough for a quick list.
const maxSearchHits = 12

// ParseTPDBSearch reads ThePornDB's answer to a search by words, which
// the administrator makes by hand: every scene found, to choose from.
func ParseTPDBSearch(data []byte) ([]Scene, error) {
	var in tpdbScenes
	if err := json.Unmarshal(data, &in); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrBadDetails, err)
	}
	scenes := make([]Scene, 0, min(len(in.Data), maxSearchHits))
	for _, s := range in.Data[:min(len(in.Data), maxSearchHits)] {
		scenes = append(scenes, sceneOf(s))
	}
	return scenes, nil
}

// sceneOf reads one scene: the site that made it is its author, the wide
// picture is the best one.
func sceneOf(s tpdbScene) Scene {
	return Scene{
		Details: Details{
			Title:       cut(oneLine(s.Title), MaxDetailsTitle),
			Description: cleanDescription(s.Description),
			Author:      cut(oneLine(s.Site.Name), MaxDetailsAuthor),
			Date:        firstDay(s.Date),
		},
		Picture: firstPicture(s.Background.Large, s.Image, s.Posters.Large),
		Thumb:   firstPicture(s.Background.Medium, s.Background.Small, s.Image, s.Background.Large, s.Posters.Large),
	}
}

func firstPicture(addresses ...string) string {
	for _, p := range addresses {
		if TPDBPicture(p) {
			return p
		}
	}
	return ""
}

func hasHash(s tpdbScene, hash string) bool {
	for _, h := range s.Hashes {
		if strings.EqualFold(h.Hash, hash) {
			return true
		}
	}
	return false
}

// TPDBPicture says if an address is a picture on ThePornDB's own servers,
// over HTTPS. Anything else is not used, so a strange answer can never
// make FranzPLAY download from somewhere else.
func TPDBPicture(address string) bool {
	u, err := url.Parse(address)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	for _, domain := range []string{"theporndb.net", "metadataapi.net"} {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return true
		}
	}
	return false
}
