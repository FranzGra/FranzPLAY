package video

import (
	"encoding/json"
	"fmt"
	"path"
	"regexp"
	"strings"
)

// youTubeIDInName finds a YouTube code at the end of a file name, the way
// yt-dlp names its files: "Gita in montagna [dQw4w9WgXcQ].mp4".
var youTubeIDInName = regexp.MustCompile(`\[([A-Za-z0-9_-]{11})\]$`)

// YouTubeID returns the YouTube code in the name of a video file, if the
// name has one. Only the name is looked at, not the folders.
func YouTubeID(file string) (string, bool) {
	name := path.Base(strings.ReplaceAll(file, `\`, "/"))
	name = strings.TrimSpace(strings.TrimSuffix(name, path.Ext(name)))
	m := youTubeIDInName.FindStringSubmatch(name)
	if m == nil {
		return "", false
	}
	return m[1], true
}

// oEmbed are the fields of YouTube's oEmbed answer FranzPLAY uses.
type oEmbed struct {
	Title      string `json:"title"`
	AuthorName string `json:"author_name"`
}

// ParseOEmbed reads YouTube's answer about a video: its title and its
// channel. What comes from the internet is checked here, once, like what
// comes from the files next to the videos.
func ParseOEmbed(data []byte) (Details, error) {
	var in oEmbed
	if err := json.Unmarshal(data, &in); err != nil {
		return Details{}, fmt.Errorf("%w: %w", ErrBadDetails, err)
	}
	return Details{
		Title:  cut(oneLine(in.Title), MaxDetailsTitle),
		Author: cut(oneLine(in.AuthorName), MaxDetailsAuthor),
	}, nil
}
