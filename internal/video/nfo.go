package video

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"time"
)

// NFOSuffix ends the name of the file Kodi and Jellyfin read next to a
// video: "mare.mp4" has "mare.nfo".
const NFOSuffix = ".nfo"

// MaxNFOSize is the biggest .nfo file read. They hold a few lines of
// text; a bigger file is not one of them.
const MaxNFOSize = 1 << 20

// nfoFile are the fields of an .nfo file FranzPLAY uses. Kodi writes
// <movie> for films, <episodedetails> for episodes (tools that save
// YouTube channels use this one, with the channel as the show) and
// <musicvideo> for songs.
type nfoFile struct {
	XMLName     xml.Name
	Title       string   `xml:"title"`
	Plot        string   `xml:"plot"`
	Outline     string   `xml:"outline"`
	ShowTitle   string   `xml:"showtitle"`
	Artists     []string `xml:"artist"`
	Directors   []string `xml:"director"`
	Studios     []string `xml:"studio"`
	Premiered   string   `xml:"premiered"`
	Aired       string   `xml:"aired"`
	ReleaseDate string   `xml:"releasedate"`
}

// nfoKinds are the kinds of .nfo file about one video.
var nfoKinds = map[string]bool{"movie": true, "episodedetails": true, "musicvideo": true}

// ParseNFO reads the .nfo file of Kodi and Jellyfin next to a video. As
// with ParseInfoJSON, what comes from the file is checked here, once.
// Kodi also allows an .nfo with only a web address in it, for its own
// online search: that says nothing about the video, so it gives no details.
func ParseNFO(data []byte) (Details, error) {
	if !bytes.Contains(data, []byte("<")) {
		return Details{}, nil
	}
	var in nfoFile
	dec := xml.NewDecoder(bytes.NewReader(data))
	dec.Entity = xml.HTMLEntity // files written by hand often use &nbsp; and the like
	if err := dec.Decode(&in); err != nil {
		return Details{}, fmt.Errorf("%w: %w", ErrBadDetails, err)
	}
	if !nfoKinds[in.XMLName.Local] {
		return Details{}, fmt.Errorf("%w: <%s> is not about one video", ErrBadDetails, in.XMLName.Local)
	}
	description := cleanDescription(in.Plot)
	if description == "" {
		description = cleanDescription(in.Outline)
	}
	// Who made it: the channel, the singer, who filmed it, the studio.
	authors := append([]string{in.ShowTitle}, in.Artists...)
	authors = append(authors, in.Directors...)
	authors = append(authors, in.Studios...)
	return Details{
		Title:       cut(oneLine(in.Title), MaxDetailsTitle),
		Description: description,
		Author:      cut(firstLine(authors), MaxDetailsAuthor),
		Date:        firstDay(in.Premiered, in.Aired, in.ReleaseDate),
	}, nil
}

// firstLine returns the first text that is not empty once on one line.
func firstLine(texts []string) string {
	for _, s := range texts {
		if s = oneLine(s); s != "" {
			return s
		}
	}
	return ""
}

// firstDay returns the first real day among Kodi's dates, "2006-01-02",
// sometimes followed by the time.
func firstDay(dates ...string) string {
	for _, s := range dates {
		s = oneLine(s)
		if len(s) > len(time.DateOnly) && s[len(time.DateOnly)] == ' ' {
			s = s[:len(time.DateOnly)]
		}
		if t, err := time.Parse(time.DateOnly, s); err == nil && sensibleYear(t) {
			return t.Format(time.DateOnly)
		}
	}
	return ""
}

// Or fills what d does not know with what other says.
func (d Details) Or(other Details) Details {
	pick := func(a, b string) string {
		if a != "" {
			return a
		}
		return b
	}
	return Details{
		Title:       pick(d.Title, other.Title),
		Description: pick(d.Description, other.Description),
		Author:      pick(d.Author, other.Author),
		Date:        pick(d.Date, other.Date),
	}
}
