package video

import (
	"fmt"
	"hash/fnv"
	"path"
	"strconv"
	"strings"
)

// A picture next to a video, with its name, is used as its cover instead
// of a frame of the video: for "mare.mp4" that is "mare.jpg",
// "mare-poster.jpg" and so on. It is how yt-dlp saves covers with
// --write-thumbnail, and how Jellyfin and Kodi name them. The picture is
// only read: nothing is written next to the video (rule 1).

// coverImageEndings are what may follow the name of the video, best first.
var coverImageEndings = []string{"", "-poster", "-thumb", "-cover"}

// imageExtensions are the pictures that can become a cover, best first.
var imageExtensions = []string{".jpg", ".jpeg", ".png", ".webp"}

// IsImage reports whether a file name looks like a picture FranzPLAY can
// use: JPEG, PNG or WebP. Hidden files (starting with ".") are not: on
// macOS "._mare.jpg" files are metadata.
func IsImage(name string) bool {
	if strings.HasPrefix(name, ".") {
		return false
	}
	ext := strings.ToLower(path.Ext(name))
	for _, e := range imageExtensions {
		if ext == e {
			return true
		}
	}
	return false
}

// CoverImage picks, among the files of a folder, the picture used as the
// cover of the video named videoName in that same folder. Upper and lower
// case do not matter, so "MARE.JPG" is found for "mare.mp4". It reports
// false when there is none.
func CoverImage(videoName string, folder []string) (string, bool) {
	base := strings.ToLower(strings.TrimSuffix(videoName, path.Ext(videoName)))
	byName := make(map[string]string, len(folder))
	for _, name := range folder {
		if IsImage(name) {
			lower := strings.ToLower(name)
			if _, seen := byName[lower]; !seen {
				byName[lower] = name
			}
		}
	}
	for _, ending := range coverImageEndings {
		for _, ext := range imageExtensions {
			if name, ok := byName[base+ending+ext]; ok {
				return name, true
			}
		}
	}
	return "", false
}

// ImageVersion is a short mark that changes when a picture is replaced:
// it is made from its name, size and modification time (Unix nanoseconds).
// It goes in the name of what is made from the picture, so a browser
// never shows what was made from the old one. It is 8 hexadecimal
// digits, like the rest of the names of the files FranzPLAY makes.
func ImageVersion(name string, size, modTime int64) string {
	h := fnv.New32a()
	h.Write([]byte(name + "\x00" + strconv.FormatInt(size, 10) + "\x00" + strconv.FormatInt(modTime, 10)))
	return fmt.Sprintf("%08x", h.Sum32())
}
