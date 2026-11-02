package content

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

// Reused is what a video's folder gives back to a database that does not know
// the video: only what video.json says and the disk confirms. All the values are
// ready for the database; "" means there is nothing to put there.
type Reused struct {
	Folder string // the name of the folder, for the logs
	Info   *Info  // nil: the video must be read again, and its jobs follow

	// Unreadable says a folder seems to be this video's, but cannot say so: its
	// video.json is damaged, or from a newer FranzPLAY. Nothing else here is
	// filled in. Nobody can say whether the video was hidden or private.
	Unreadable bool

	Title   string  // what people see, for an uploaded video: its file name says nothing
	AddedAt int64   // 0: not known, the row keeps today
	SavedAt int64   // when video.json last changed, Unix seconds; 0: not known
	Access  *Access // nil: a video.json that does not say, the row stays as it is

	Cover, Clip, ClipHD, Converted string
	OwnCover, OwnClip              string
	CoverSecond                    *int64
	NoClip                         bool
	AdminTitle, AdminCategory      *string
	CoverImage                     *string

	Preview                     string
	PreviewGap, PreviewCount    int64
	PreviewWidth, PreviewHeight int64

	Online      Online // Image is not used: see OnlineImage
	OnlineImage string
	Audio       []Audio
	Inside      []Subtitle // File already as the database saves it
	Auto        []Subtitle // the same
	Skipped     []string   // files named in video.json that cannot be used

	finished map[string]bool
}

// Finished reports whether a job is done, and its result is here: it must not
// run again. Whatever is not finished is made again by its job as usual.
func (u *Reused) Finished(kind string) bool { return u.finished[kind] }

// checkedFolder checks the names video.json gives against the disk.
type checkedFolder struct {
	root    *os.Root
	code    string
	skipped *[]string
}

// has reports whether a file is really in the folder, and is not empty. An
// os.Root cannot look outside its folder, not even through a link.
func (c checkedFolder) has(file string) bool {
	info, err := c.root.Lstat(filepath.FromSlash(file))
	if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
		*c.skipped = append(*c.skipped, file)
		return false
	}
	return true
}

// fixed returns the database's value for a file with a fixed name, "" if the
// file is not usable. A name that is not the one expected is not even looked at.
func (c checkedFolder) fixed(f *File, name string) string {
	if f == nil {
		return ""
	}
	if f.File != name {
		*c.skipped = append(*c.skipped, f.File)
		return ""
	}
	if !c.has(name) {
		return ""
	}
	return Stored(c.code, name, f.Version)
}

// chosen returns the database's value for a file the administrator chose, whose
// name is prefix and the extension it was sent with.
func (c checkedFolder) chosen(file, version, prefix string) string {
	if file == "" {
		return ""
	}
	ext, ok := strings.CutPrefix(file, prefix+".")
	if !ok || !validExt.MatchString(ext) {
		*c.skipped = append(*c.skipped, file)
		return ""
	}
	if !c.has(file) {
		return ""
	}
	return Stored(c.code, file, version)
}

var (
	validExt  = regexp.MustCompile(`^[A-Za-z0-9]{1,10}$`)
	validLang = regexp.MustCompile(`^[a-z]{2,3}$`)
)

// Reuse looks for the folders of videos the database does not know yet, by their
// fingerprint: the videos of a database lost, or of content copied here. It reads
// the disk once for all of them and only reads: a folder that is damaged or from a
// newer FranzPLAY is logged, and stays as it is. The video then gets a longer code,
// as with two videos ending with the same characters, and an Unreadable answer.
// When the folder of the videos cannot be read at all it returns an error: then
// nobody can say which videos are hidden, and none must be added as new.
func (r Root) Reuse(ctx context.Context, fingerprints []string, logger *slog.Logger) (map[string]*Reused, error) {
	x := r.index()
	x.mu.Lock()
	defer x.mu.Unlock()
	if err := x.read(r); err != nil {
		return nil, fmt.Errorf("look for folders to reuse: %w", err)
	}
	found := map[string]*Reused{}
	for _, fingerprint := range fingerprints {
		unreadable := ""
		for _, code := range codes(fingerprint) {
			e, ok := x.folders[code]
			if !ok {
				continue
			}
			dir := filepath.Join(r.VideoFolders(), e.name)
			m, err := readManifest(dir)
			if err != nil {
				logger.WarnContext(ctx, "folder of a video not reused and left as it is", "folder", e.name, "error", err)
				unreadable = e.name
				continue
			}
			if m.Fingerprint != fingerprint {
				continue
			}
			u, err := reuseFolder(dir, code, e.name, m)
			if err != nil {
				logger.WarnContext(ctx, "folder of a video not reused and left as it is", "folder", e.name, "error", err)
				unreadable = e.name
				continue
			}
			found[fingerprint] = u
			break
		}
		if _, ok := found[fingerprint]; !ok && unreadable != "" {
			found[fingerprint] = &Reused{Folder: unreadable, Unreadable: true}
		}
	}
	return found, nil
}

// reuseFolder decides what of a folder can be used.
func reuseFolder(dir, code, name string, m Manifest) (_ *Reused, err error) {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("open folder: %w", err)
	}
	defer func() { err = errors.Join(err, root.Close()) }()
	u := &Reused{Folder: name, finished: map[string]bool{},
		CoverSecond: m.Choices.CoverSecond, NoClip: m.Choices.NoClip,
		AdminTitle: m.Choices.Title, AdminCategory: m.Choices.Category, CoverImage: m.CoverImage,
		Title: m.Title, AddedAt: m.AddedAt, SavedAt: m.SavedAt, Access: m.Access}
	c := checkedFolder{root: root, code: code, skipped: &u.Skipped}
	done := func(kind string) bool { return slices.Contains(m.Done, kind) }

	u.Cover = c.fixed(m.Cover, FileCover)
	u.Clip = c.fixed(m.Clip, FileClip)
	u.ClipHD = c.fixed(m.ClipHD, FileClipHD)
	u.Converted = c.fixed(m.Converted, FileConverted)
	u.OwnCover = c.chosen(m.Choices.CoverFile, m.Choices.CoverVersion, FileOwnCover)
	u.OwnClip = c.chosen(m.Choices.ClipFile, m.Choices.ClipVersion, FileOwnClip)
	if m.Online != nil {
		u.Online = *m.Online
		u.OnlineImage = c.fixed(m.Online.Image, FileOnlineImage)
	}
	if t := m.Timeline; t != nil && t.Gap > 0 && t.Count > 0 && t.Width > 0 && t.Height > 0 {
		if u.Preview = c.fixed(&File{File: t.File, Version: t.Version}, FileTimeline); u.Preview != "" {
			u.PreviewGap, u.PreviewCount, u.PreviewWidth, u.PreviewHeight = t.Gap, t.Count, t.Width, t.Height
		}
	}
	tracksWhole := u.addSubtitles(c, m.Subtitles)
	u.Audio = m.Audio

	// A file named and not usable makes its job run again; a job done with no
	// file to name (too short, plays as it is) stays done.
	ownCoverLost := m.Choices.CoverFile != "" && u.OwnCover == ""
	ownClipLost := m.Choices.ClipFile != "" && u.OwnClip == ""
	if done(jobProbe) && m.Info != nil {
		u.Info = m.Info
		u.finished[jobProbe] = true
	}
	u.finished[jobCover] = done(jobCover) && u.Cover != "" && !ownCoverLost
	u.finished[jobPreview] = done(jobPreview) && (m.Timeline == nil || u.Preview != "")
	u.finished[jobClip] = done(jobClip) && !ownClipLost && (m.Clip == nil || u.Clip != "") && (m.ClipHD == nil || u.ClipHD != "")
	u.finished[jobTracks] = done(jobTracks) && tracksWhole
	u.finished[jobConvert] = done(jobConvert) && (m.Converted == nil || u.Converted != "")
	u.finished[jobOnline] = done(jobOnline) && (m.Online == nil || m.Online.Image == nil || u.OnlineImage != "")
	return u, nil
}

// addSubtitles keeps the subtitles that can be used, and reports whether all the
// ones copied from the video file are among them. Two lines saying the same
// track or the same language are read once.
func (u *Reused) addSubtitles(c checkedFolder, subs []Subtitle) (tracksWhole bool) {
	tracksWhole = true
	streams, langs := map[int64]bool{}, map[string]bool{}
	for _, s := range subs {
		var wanted string
		switch {
		case s.Stream != nil && *s.Stream >= 0 && *s.Stream < 1<<20:
			wanted = InsideSubtitleFile(int(*s.Stream))
		case s.Stream == nil && validLang.MatchString(s.Lang):
			wanted = AutoSubtitleFile(s.Lang)
		}
		ok := wanted != "" && s.File == wanted
		if !ok {
			*c.skipped = append(*c.skipped, s.File)
		}
		ok = ok && c.has(wanted)
		if s.Stream != nil {
			tracksWhole = tracksWhole && ok
			if ok && !streams[*s.Stream] {
				streams[*s.Stream] = true
				s.File = Stored(c.code, wanted, "")
				u.Inside = append(u.Inside, s)
			}
			continue
		}
		if ok && !langs[s.Lang] {
			langs[s.Lang] = true
			s.File = Stored(c.code, wanted, "")
			u.Auto = append(u.Auto, s)
		}
	}
	return tracksWhole
}

// Leftover is a folder among those of the videos with no video in the database.
type Leftover struct {
	Path  string `json:"path"`  // the whole path, as FranzPLAY sees it
	Title string `json:"title"` // from its video.json; "" if it cannot be read
	Size  int64  `json:"size"`  // bytes
	// Unreadable: it has a code but its video.json cannot be read, so its video,
	// when it arrives, stays hidden until the administrator shows it.
	Unreadable bool `json:"unreadable"`
}

// Leftovers lists, in the order of their names, the first folders with no video
// in the database, up to limit, and says how many there are. It only reads. The
// video.json of every folder was read once and is remembered, so only the folders
// listed cost something.
func Leftovers(ctx context.Context, db *sql.DB, r Root, limit int) (_ []Leftover, total int, err error) {
	entries, err := os.ReadDir(r.VideoFolders())
	if errors.Is(err, fs.ErrNotExist) {
		return []Leftover{}, 0, nil
	}
	if err != nil {
		return nil, 0, fmt.Errorf("read video folders: %w", err)
	}
	known, err := column(ctx, db, `SELECT fingerprint FROM videos`)
	if err != nil {
		return nil, 0, err
	}
	used, err := usedCodes(ctx, db)
	if err != nil {
		return nil, 0, err
	}
	whose, err := r.fingerprints()
	if err != nil {
		return nil, 0, err
	}
	out := []Leftover{}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".new-") {
			continue
		}
		code, hasCode := codeOfFolder(e.Name())
		owner, indexed := whose[e.Name()]
		if hasCode && indexed && (known[owner] || used[code]) {
			continue
		}
		total++
		if len(out) < limit {
			l := leftover(filepath.Join(r.VideoFolders(), e.Name()))
			if hasCode {
				_, err := readManifest(l.Path)
				l.Unreadable = err != nil
			}
			out = append(out, l)
		}
	}
	return out, total, nil
}

// leftover describes a folder. Its title is read even from a video.json of a
// newer FranzPLAY: here it is only shown.
func leftover(dir string) Leftover {
	l := Leftover{Path: dir}
	if data, err := readManifestFile(dir); err == nil {
		var m struct {
			Title string `json:"title"`
		}
		if json.Unmarshal(data, &m) == nil {
			l.Title = m.Title
		}
	}
	// What cannot be read does not count: the size is only a hint.
	_ = filepath.WalkDir(dir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil //nolint:nilerr // go on with the rest
		}
		if d.Type().IsRegular() {
			if info, err := d.Info(); err == nil {
				l.Size += info.Size()
			}
		}
		return nil
	})
	return l
}
