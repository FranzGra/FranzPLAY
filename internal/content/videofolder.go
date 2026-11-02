package content

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/safefile"
)

// What FranzPLAY makes for a video lives in one folder of its own, inside
// the folder "video" of the root:
//
//	video/Nome del video [a1b2c3d4]/
//	  video.json, copertina.jpg, timeline.jpg, anteprima.mp4…
//
// The name is for people, who open the disk and understand what is there. The
// machine only reads the code between the brackets: the video can change name
// and the folder with it, and nothing else has to change.
//
// The database saves a file of such a folder as "<code>/<file>", with no
// folder name in it, and "?v=<version>" at the end when the address must
// change for browsers. A value with no "/" is a file of the old flat folders,
// like "12-a1b2c3d4.jpg": both are read, the new ones are written here.

// The files inside the folder of a video. The names never change: what changes
// is the version in the address.
const (
	FileManifest      = "video.json"
	FileCover         = "copertina.jpg"
	FileTimeline      = "timeline.jpg"
	FileClip          = "anteprima.mp4"
	FileClipHD        = "anteprima-hd.mp4"
	FileConverted     = "convertito.mp4"
	FileOnlineImage   = "immagine-online.img"
	FileProposalImage = "proposta-online.img"
	// The files chosen by the administrator, as they were sent: their
	// extension follows.
	FileOwnCover = "copertina-scelta"
	FileOwnClip  = "anteprima-scelta"
)

// subtitlesFolder holds the subtitles of a video, inside its folder.
const subtitlesFolder = "sottotitoli"

// InsideSubtitleFile is the copy of a subtitle found inside the video file.
func InsideSubtitleFile(stream int) string {
	return subtitlesFolder + "/traccia-" + strconv.Itoa(stream) + ".vtt"
}

// AutoSubtitleFile is a subtitle written by whisper, or translated.
func AutoSubtitleFile(lang string) string {
	return subtitlesFolder + "/automatici-" + lang + ".vtt"
}

// VideoFolders holds one folder per video. It stays flat: a video inside a
// subfolder of its library makes no subfolder here.
func (r Root) VideoFolders() string { return r.folder("video") }

// Work holds what is being made: temporary files and folders, renamed into
// place only when finished (rule 6). Nothing in it is ever used after a
// restart.
func (r Root) Work() string { return r.folder("in-corso") }

// MakeWork returns the Work folder, made if needed.
func (r Root) MakeWork() (string, error) {
	dir := r.Work()
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", fmt.Errorf("create work folder: %w", err)
	}
	return dir, nil
}

// RemoveWork deletes what a crash left half done: this folder, and the new
// folders of videos not yet renamed into place. It must run before the job
// worker and the web server start.
func RemoveWork(r Root) error {
	if err := os.RemoveAll(r.Work()); err != nil {
		return fmt.Errorf("remove unfinished work: %w", err)
	}
	return r.removeUnfinishedFolders()
}

// maxFolderName is the longest name given to a folder, in bytes, before its
// code. Disks take 255; the rest stays free for the code and for tools that
// add something to the name when copying.
const maxFolderName = 120

// shortCode is how long a code is. Only two different videos ending with the
// same characters get a longer one, codeStep at a time.
const (
	shortCode = 8
	codeStep  = 4
)

// codeSource is what the code of a fingerprint is cut from: its hexadecimal
// part, so a code is the last characters of the fingerprint, as in the names
// of the old flat folders.
func codeSource(fingerprint string) string {
	s := fingerprint[strings.LastIndexByte(fingerprint, ':')+1:]
	if validCode(s) {
		return s
	}
	sum := sha256.Sum256([]byte(fingerprint))
	return hex.EncodeToString(sum[:])
}

// codes returns the codes a fingerprint may have, shortest first.
func codes(fingerprint string) []string {
	s := codeSource(fingerprint)
	var all []string
	for n := shortCode; n < len(s); n += codeStep {
		all = append(all, s[len(s)-n:])
	}
	return append(all, s)
}

// validCode reports whether s can be a code: lower case hexadecimal digits.
func validCode(s string) bool {
	if len(s) < shortCode || len(s) > sha256.Size*2 {
		return false
	}
	for _, c := range s {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

// codeOfFolder reads the code at the end of a folder's name, like
// "Nome del video [a1b2c3d4]". It says nothing else about the name.
func codeOfFolder(name string) (string, bool) {
	rest, ok := strings.CutSuffix(name, "]")
	if !ok {
		return "", false
	}
	i := strings.LastIndex(rest, " [")
	if i < 0 || !validCode(rest[i+2:]) {
		return "", false
	}
	return rest[i+2:], true
}

// notForNames are the characters Windows, Linux or both refuse in a name.
const notForNames = `<>:"/\|?*`

// reservedNames are refused by Windows, also before a dot: "CON.mp4".
var reservedNames = regexp.MustCompile(`(?i)^(con|prn|aux|nul|com[0-9]|lpt[0-9])$`)

// FolderName is the name of the folder of a video: the name of its file with
// no extension, cleaned so that Linux and Windows both take it, cut without
// breaking a character, then its code.
func FolderName(videoPath, code string) string {
	base := path.Base(videoPath)
	base = strings.ToValidUTF8(strings.TrimSuffix(base, path.Ext(base)), "")
	base = strings.Map(func(c rune) rune {
		if c < 0x20 || c == 0x7f || strings.ContainsRune(notForNames, c) {
			return ' '
		}
		return c
	}, base)
	base = strings.Join(strings.Fields(base), " ")
	if len(base) > maxFolderName {
		cut := maxFolderName
		for cut > 0 && !isCharStart(base[cut]) {
			cut--
		}
		base = base[:cut]
	}
	// A leading dot hides a folder, and Windows drops a final dot or space.
	base = strings.Trim(base, ". ")
	first, _, _ := strings.Cut(base, ".")
	switch {
	case base == "":
		base = "video"
	case reservedNames.MatchString(strings.TrimSpace(first)):
		base = "_" + base
	}
	return base + " [" + code + "]"
}

// isCharStart reports whether b is the first byte of a UTF-8 character.
func isCharStart(b byte) bool { return b&0xc0 != 0x80 }

// folderEntry is a folder of a video the index knows.
type folderEntry struct {
	name        string
	fingerprint string // from its video.json, "" until read
}

// folderIndex says which folder has which code. The disk says the truth: a
// code not known, or a folder gone, makes the index read the disk again, so a
// folder renamed by hand is found too. It also makes sure a folder is never
// renamed under a file being put in it.
type folderIndex struct {
	mu       sync.RWMutex
	folders  map[string]folderEntry // by code
	readAt   time.Time
	manifest sync.Mutex // one video.json written at a time
}

// indexes holds the index of each root. A Root is only a string, so this
// lives here, and one process has one root (tests have many).
var indexes sync.Map

func (r Root) index() *folderIndex {
	i, ok := indexes.Load(r)
	if !ok {
		i, _ = indexes.LoadOrStore(r, &folderIndex{})
	}
	return i.(*folderIndex) //nolint:forcetypeassert // only this function stores here
}

// readAgainAfter keeps a flood of codes that do not exist from reading the
// folder at every request.
const readAgainAfter = time.Second

// read fills the index from the disk. The caller holds the lock for writing.
func (x *folderIndex) read(r Root) error {
	entries, err := os.ReadDir(r.VideoFolders())
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("read video folders: %w", err)
	}
	folders := make(map[string]folderEntry, len(entries))
	for _, e := range entries {
		code, ok := codeOfFolder(e.Name())
		if !ok || !e.IsDir() {
			continue
		}
		if _, taken := folders[code]; taken {
			continue // two folders with one code, by hand: the first one wins
		}
		entry := folderEntry{name: e.Name()}
		if old, known := x.folders[code]; known && old.name == e.Name() {
			entry = old
		}
		folders[code] = entry
	}
	x.folders, x.readAt = folders, time.Now()
	return nil
}

// loaded reads the disk the first time. The caller holds the lock for writing.
func (x *folderIndex) loaded(r Root) error {
	if x.folders != nil {
		return nil
	}
	return x.read(r)
}

// nameOf returns the name of the folder with a code.
func (r Root) nameOf(code string) (string, bool) {
	x := r.index()
	x.mu.RLock()
	e, ok := x.folders[code]
	fresh := x.folders != nil && time.Since(x.readAt) < readAgainAfter
	x.mu.RUnlock()
	if ok {
		_, err := os.Stat(filepath.Join(r.VideoFolders(), e.name))
		if !errors.Is(err, fs.ErrNotExist) {
			return e.name, true
		}
	}
	if fresh {
		return "", false
	}
	x.mu.Lock()
	defer x.mu.Unlock()
	if err := x.read(r); err != nil {
		return "", false
	}
	e, ok = x.folders[code]
	return e.name, ok
}

// fingerprintOf returns the fingerprint in the video.json of a folder, keeping
// it. The caller holds the lock for writing. It is "" when the file cannot be
// read: then nobody can say whose the folder is.
func (x *folderIndex) fingerprintOf(r Root, code string) string {
	e, ok := x.folders[code]
	if !ok {
		return ""
	}
	if e.fingerprint == "" {
		m, err := readManifest(filepath.Join(r.VideoFolders(), e.name))
		if err != nil {
			return ""
		}
		e.fingerprint = m.Fingerprint
		x.folders[code] = e
	}
	return e.fingerprint
}

// find returns the code of the folder of a fingerprint. The caller holds the
// lock for writing.
func (x *folderIndex) find(r Root, fingerprint string) (string, bool) {
	for _, code := range codes(fingerprint) {
		if x.fingerprintOf(r, code) == fingerprint {
			return code, true
		}
	}
	return "", false
}

// FolderOf returns the code of the folder of a video's content, if it has one.
func (r Root) FolderOf(fingerprint string) (code string, ok bool, err error) {
	x := r.index()
	x.mu.Lock()
	defer x.mu.Unlock()
	if err := x.loaded(r); err != nil {
		return "", false, err
	}
	code, ok = x.find(r, fingerprint)
	return code, ok, nil
}

// EnsureFolder returns the code of the folder of a video's content, making it
// the first time, already with its video.json. A folder is never shared: when
// the short code belongs to another fingerprint, or to a folder that cannot
// say whose it is, this one gets a longer code. created says it was made now.
func (r Root) EnsureFolder(fingerprint, videoPath string) (code string, created bool, err error) {
	x := r.index()
	x.mu.Lock()
	defer x.mu.Unlock()
	if err := x.loaded(r); err != nil {
		return "", false, err
	}
	if code, ok := x.find(r, fingerprint); ok {
		e := x.folders[code]
		if _, err := os.Stat(filepath.Join(r.VideoFolders(), e.name)); !errors.Is(err, fs.ErrNotExist) {
			return code, false, nil
		}
		// Taken away by hand since the last look.
		if err := x.read(r); err != nil {
			return "", false, err
		}
		if code, ok := x.find(r, fingerprint); ok {
			return code, false, nil
		}
	}
	// A folder copied here while FranzPLAY runs is not made a second time.
	if err := x.read(r); err != nil {
		return "", false, err
	}
	if code, ok := x.find(r, fingerprint); ok {
		return code, false, nil
	}
	for _, c := range codes(fingerprint) {
		if _, taken := x.folders[c]; !taken {
			code = c
			break
		}
	}
	if code == "" {
		return "", false, fmt.Errorf("no free code for %s", fingerprint)
	}
	name := FolderName(videoPath, code)
	if err := r.makeFolder(name, Manifest{Version: ManifestVersion, Fingerprint: fingerprint, Path: videoPath}); err != nil {
		return "", false, err
	}
	x.folders[code] = folderEntry{name: name, fingerprint: fingerprint}
	return code, true, nil
}

// makeFolder makes a folder with its video.json, all or nothing (rule 6): a
// folder with a code always says whose it is.
func (r Root) makeFolder(name string, m Manifest) (err error) {
	parent := r.VideoFolders()
	if err := os.MkdirAll(parent, 0o750); err != nil {
		return fmt.Errorf("create video folders: %w", err)
	}
	work, err := os.MkdirTemp(parent, ".new-*")
	if err != nil {
		return fmt.Errorf("create folder of a video: %w", err)
	}
	defer func() {
		if rmErr := os.RemoveAll(work); rmErr != nil && err == nil {
			err = rmErr
		}
	}()
	if err := writeManifest(work, m); err != nil {
		return err
	}
	// MkdirTemp makes it for this user alone, like the other folders here.
	if err := os.Chmod(work, 0o750); err != nil { //nolint:gosec // folders of the content are 0o750 everywhere
		return fmt.Errorf("create folder of a video: %w", err)
	}
	if err := os.Rename(work, filepath.Join(parent, name)); err != nil {
		return fmt.Errorf("create folder of a video: %w", err)
	}
	return nil
}

// FollowName gives the folder of a video the name its file asks for. It
// reports whether the name changed. A folder that cannot be renamed keeps
// working: only its name is old, and the next scan tries again.
func (r Root) FollowName(fingerprint, videoPath string) (renamed bool, err error) {
	x := r.index()
	x.mu.Lock()
	defer x.mu.Unlock()
	if err := x.loaded(r); err != nil {
		return false, err
	}
	code, ok := x.find(r, fingerprint)
	if !ok {
		return false, nil
	}
	e := x.folders[code]
	name := FolderName(videoPath, code)
	if e.name == name {
		return false, nil
	}
	if err := os.Rename(filepath.Join(r.VideoFolders(), e.name), filepath.Join(r.VideoFolders(), name)); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			// Renamed by hand: the next scan sees its real name.
			return false, errors.Join(err, x.read(r))
		}
		return false, fmt.Errorf("rename folder %q: %w", e.name, err)
	}
	e.name = name
	x.folders[code] = e
	return true, nil
}

// Stored is what the database saves for a file of the folder with a code.
func Stored(code, file, version string) string {
	s := code + "/" + file
	if version != "" {
		s += "?v=" + version
	}
	return s
}

// storedFile is a value of the database that names a file of a video's folder.
type storedFile struct {
	code, file, version string
}

// parseStored reads a value of the database. ok is false for a file of the old
// flat folders, and for anything else that is not sure to stay in its folder.
func parseStored(value string) (s storedFile, ok bool) {
	rest, version, _ := strings.Cut(value, "?v=")
	code, file, found := strings.Cut(rest, "/")
	if !found || !validCode(code) || !filepath.IsLocal(filepath.FromSlash(file)) {
		return storedFile{}, false
	}
	return storedFile{code: code, file: file, version: version}, true
}

// IsStored reports whether a value of the database names a file of a video's
// folder, and not a file of the old flat folders.
func IsStored(value string) bool {
	_, ok := parseStored(value)
	return ok
}

// CodeOf returns the code in a value of the database, "" for an old one.
func CodeOf(value string) string {
	s, _ := parseStored(value)
	return s.code
}

// FileOf returns the file in a value of the database, relative to the folder
// of its video and with "/"; "" for an old one.
func FileOf(value string) string {
	s, _ := parseStored(value)
	return s.file
}

// Version returns the version in a value of the database, "" if it has none.
func Version(value string) string {
	s, _ := parseStored(value)
	return s.version
}

// SameFile reports whether two values of the database name one file on the
// disk, even with different versions.
func SameFile(a, b string) bool {
	sa, oka := parseStored(a)
	sb, okb := parseStored(b)
	if oka && okb {
		return sa.code == sb.code && sa.file == sb.file
	}
	return a == b
}

// File returns where a value of the database is on the disk. flat is the old
// flat folder such a file would be in. A file whose folder is not there gets a
// path that does not exist, so whoever opens it finds it missing.
func (r Root) File(value, flat string) string {
	s, ok := parseStored(value)
	if !ok {
		return filepath.Join(flat, filepath.Base(value))
	}
	return r.FileIn(s.code, s.file)
}

// FileIn returns where a file of the folder with a code is on the disk.
func (r Root) FileIn(code, file string) string {
	name, ok := r.nameOf(code)
	if !ok {
		name = "[" + code + "]"
	}
	return filepath.Join(r.VideoFolders(), name, filepath.FromSlash(file))
}

// Put moves a finished temporary file into the folder with a code.
func (r Root) Put(code, file, tmp string) error {
	x := r.index()
	x.mu.RLock()
	defer x.mu.RUnlock()
	e, ok := x.folders[code]
	if !ok {
		return fmt.Errorf("put %s: no folder with code %s: %w", file, code, fs.ErrNotExist)
	}
	to := filepath.Join(r.VideoFolders(), e.name, filepath.FromSlash(file))
	if err := os.MkdirAll(filepath.Dir(to), 0o750); err != nil {
		return fmt.Errorf("put %s: %w", file, err)
	}
	if err := safefile.Rename(tmp, to); err != nil {
		return fmt.Errorf("put %s: %w", file, err)
	}
	return nil
}

// PutBytes writes a file in the folder with a code, all or nothing.
func (r Root) PutBytes(code, file string, data []byte) (err error) {
	dir, err := r.MakeWork()
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".new-*")
	if err != nil {
		return fmt.Errorf("put %s: %w", file, err)
	}
	defer func() {
		// Left over only when something failed; after success it was renamed.
		if rmErr := os.Remove(tmp.Name()); rmErr != nil && !errors.Is(rmErr, fs.ErrNotExist) {
			err = errors.Join(err, rmErr)
		}
	}()
	if _, err := tmp.Write(data); err != nil {
		return errors.Join(fmt.Errorf("put %s: %w", file, err), tmp.Close())
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("put %s: %w", file, err)
	}
	return r.Put(code, file, tmp.Name())
}

// Remove deletes the file a value of the database names, in a video's folder
// or in the old flat folder. A file already gone is fine.
func (r Root) Remove(value, flat string) error {
	if err := os.Remove(r.File(value, flat)); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("remove old %s: %w", value, err)
	}
	return nil
}

// RemoveNotKept deletes the file of old unless it is also the file of keep:
// a file made again in its place has the same name.
func (r Root) RemoveNotKept(old, keep, flat string) error {
	if old == "" || SameFile(old, keep) {
		return nil
	}
	return r.Remove(old, flat)
}

// Address is the address a browser gets for a value of the database: route is
// where it is served, like "/api/covers/", and ext the ending of the files
// there. The file in the folder is the route's own, so the address only says
// the code, and the version keeps browsers from showing an old file.
func Address(route, value, ext string) string {
	s, ok := parseStored(value)
	if !ok {
		return route + value
	}
	address := route + s.code + ext
	if s.version != "" {
		address += "?v=" + url.QueryEscape(s.version)
	}
	return address
}

// AddressName is the last part of Address with no version: what a route
// answers to, for who already knows the value.
func AddressName(value, ext string) string {
	s, ok := parseStored(value)
	if !ok {
		return value
	}
	return s.code + ext
}

// CodeOfAddress reads the code from the last part of an address. ok is false
// for the name of a file of the old flat folders.
func CodeOfAddress(name, ext string) (code string, ok bool) {
	code, found := strings.CutSuffix(name, ext)
	if !found || !validCode(code) {
		return "", false
	}
	return code, true
}

// ManifestVersion is the format of video.json.
const ManifestVersion = 1

// encodeManifest is the content of a video.json.
func encodeManifest(m Manifest) ([]byte, error) {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("write %s: %w", FileManifest, err)
	}
	return append(data, '\n'), nil
}

// writeManifest writes the video.json of a folder, all or nothing: a temporary
// file next to it, renamed when complete.
func writeManifest(dir string, m Manifest) (err error) {
	data, err := encodeManifest(m)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".new-*")
	if err != nil {
		return fmt.Errorf("write %s: %w", FileManifest, err)
	}
	defer func() {
		if rmErr := os.Remove(tmp.Name()); rmErr != nil && !errors.Is(rmErr, fs.ErrNotExist) {
			err = errors.Join(err, rmErr)
		}
	}()
	if _, err := tmp.Write(data); err != nil {
		return errors.Join(fmt.Errorf("write %s: %w", FileManifest, err), tmp.Close())
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("write %s: %w", FileManifest, err)
	}
	// CreateTemp makes it for this user alone, like the other files here.
	if err := os.Chmod(tmp.Name(), 0o640); err != nil { //nolint:gosec // a text file with no secret in it
		return fmt.Errorf("write %s: %w", FileManifest, err)
	}
	if err := safefile.Rename(tmp.Name(), filepath.Join(dir, FileManifest)); err != nil {
		return fmt.Errorf("write %s: %w", FileManifest, err)
	}
	return nil
}

// maxManifest is the largest video.json read. A film with many subtitles takes
// a few kilobytes: anything this big is not one of ours.
const maxManifest = 4 << 20

// readManifest reads the video.json of a folder. A file damaged, or written by a
// newer FranzPLAY that may mean something else by it, gives an error: that
// folder cannot say whose it is, and nobody touches it.
func readManifest(dir string) (Manifest, error) {
	data, err := readManifestFile(dir)
	if err != nil {
		return Manifest{}, fmt.Errorf("read %s: %w", FileManifest, err)
	}
	m, err := parseManifest(data)
	if err != nil {
		return Manifest{}, fmt.Errorf("read %s: %w", FileManifest, err)
	}
	return m, nil
}

// readManifestFile reads the bytes of the video.json of a folder.
func readManifestFile(dir string) ([]byte, error) {
	f, err := os.Open(filepath.Join(dir, FileManifest))
	if err != nil {
		return nil, err
	}
	data, err := io.ReadAll(io.LimitReader(f, maxManifest+1))
	if err = errors.Join(err, f.Close()); err != nil {
		return nil, err
	}
	if len(data) > maxManifest {
		return nil, errors.New("too big")
	}
	return data, nil
}

// parseManifest understands the content of a video.json.
func parseManifest(data []byte) (Manifest, error) {
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return Manifest{}, err
	}
	switch {
	case m.Version > ManifestVersion:
		return Manifest{}, fmt.Errorf("version %d is newer than this FranzPLAY", m.Version)
	case m.Version < 1:
		return Manifest{}, fmt.Errorf("no valid version: %d", m.Version)
	case m.Fingerprint == "":
		return Manifest{}, errors.New("no fingerprint")
	}
	return m, nil
}

// fingerprints returns, by name of the folder, whose folder each one is, for who
// has to look at all of them. A folder with an unreadable video.json has "", and
// a second folder with one code is not there at all.
func (r Root) fingerprints() (map[string]string, error) {
	x := r.index()
	x.mu.Lock()
	defer x.mu.Unlock()
	if err := x.read(r); err != nil {
		return nil, err
	}
	names := make(map[string]string, len(x.folders))
	for code := range x.folders {
		fingerprint := x.fingerprintOf(r, code)
		names[x.folders[code].name] = fingerprint
	}
	return names, nil
}

// removeFolder deletes the folder with a code, and makes the index forget it.
func (r Root) removeFolder(code string) error {
	x := r.index()
	x.mu.Lock()
	defer x.mu.Unlock()
	e, ok := x.folders[code]
	if !ok {
		return nil
	}
	if err := os.RemoveAll(filepath.Join(r.VideoFolders(), e.name)); err != nil {
		return fmt.Errorf("remove folder %q: %w", e.name, err)
	}
	delete(x.folders, code)
	return nil
}

// removeUnfinishedFolders deletes the folders a crash left half made.
func (r Root) removeUnfinishedFolders() error {
	entries, err := os.ReadDir(r.VideoFolders())
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read video folders: %w", err)
	}
	var errs []error
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".new-") {
			errs = append(errs, os.RemoveAll(filepath.Join(r.VideoFolders(), e.Name())))
		}
	}
	return errors.Join(errs...)
}
