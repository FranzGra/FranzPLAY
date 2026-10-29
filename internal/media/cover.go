package media

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/FranzGra/FranzPLAY/internal/online"
	"github.com/FranzGra/FranzPLAY/internal/safefile"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// CoversDir is the folder, inside the data folder, that holds the covers.
const CoversDir = "covers"

// OwnCoversDir is the folder, inside the data folder, that holds the
// images the administrator uploaded as covers, as they were sent. The
// cover job turns them into covers like any other picture.
const OwnCoversDir = "own-covers"

// coverWidth is the width of every cover. 640 pixels look sharp on a phone
// and in the grid on a computer, and weigh about 30-60 KB.
const coverWidth = 640

// coverSecond picks the moment of the video used as cover: one tenth in,
// so it is past black openings and titles, but at most one minute in.
// Very short or unknown durations use the first frame.
func coverSecond(duration int64) int64 {
	if duration < 2 {
		return 0
	}
	return min(max(duration/10, 1), 60)
}

// coverName is the cover file of a video. It changes when the content
// changes, so a browser never shows the cover of the old file.
func coverName(videoID int64, fingerprint string) string {
	tail := fingerprint[max(0, len(fingerprint)-8):]
	return strconv.FormatInt(videoID, 10) + "-" + tail + ".jpg"
}

// coverChoice is where a cover comes from, besides the video itself.
type coverChoice struct {
	own           string        // image uploaded by the administrator (full path), "" if none
	second        sql.NullInt64 // moment of the video chosen by the administrator
	beside        string        // picture next to the video, with its name (full path), "" if none
	besideVersion string        // changes when that picture is replaced
	downloaded    string        // picture found on the internet (full path), "" if none
}

// tag tells apart the covers the administrator chose, and the ones made
// from a picture next to the video, so the name of the cover changes with
// them and browsers never show the old one. It is "" for the cover
// FranzPLAY picks by itself.
func (c coverChoice) tag() string {
	switch {
	case c.own != "":
		return "o" + ownTag(c.own)
	case c.second.Valid:
		return "s" + strconv.FormatInt(c.second.Int64, 10)
	case c.beside != "":
		return "i" + c.besideVersion
	default:
		return ""
	}
}

// chosenCoverName is coverName, plus the tag of the administrator's choice.
func chosenCoverName(videoID int64, fingerprint string, choice coverChoice) string {
	name := coverName(videoID, fingerprint)
	if tag := choice.tag(); tag != "" {
		name = strings.TrimSuffix(name, ".jpg") + "-" + tag + ".jpg"
	}
	return name
}

// Coverer makes the covers with ffmpeg.
type Coverer struct {
	db      *sql.DB
	ffmpeg  string // program to run
	dataDir string
	run     runFunc
}

// NewCoverer returns a coverer that runs the given ffmpeg program and
// writes covers in dataDir/covers.
func NewCoverer(db *sql.DB, ffmpeg, dataDir string) *Coverer {
	return &Coverer{db: db, ffmpeg: ffmpeg, dataDir: dataDir, run: runInBackground}
}

// Handle is the job handler for jobs.Cover.
func (c *Coverer) Handle(ctx context.Context, videoID int64) (err error) {
	file, fingerprint, err := locate(ctx, c.db, videoID)
	if err != nil {
		return err
	}
	var duration, chosenSecond sql.NullInt64
	var oldCover, onlineImage, ownImage sql.NullString
	if err := c.db.QueryRowContext(ctx, `
		SELECT duration, cover, online_cover, own_cover, cover_second FROM videos WHERE id = ?`, videoID).
		Scan(&duration, &oldCover, &onlineImage, &ownImage, &chosenSecond); err != nil {
		return fmt.Errorf("read video %d: %w", videoID, err)
	}

	dir := filepath.Join(c.dataDir, CoversDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("create covers folder: %w", err)
	}

	// Rule 6: ffmpeg writes a temporary file, renamed only when complete.
	tmp, err := os.CreateTemp(dir, ".new-*.jpg")
	if err != nil {
		return fmt.Errorf("cover of video %d: %w", videoID, err)
	}
	tmpName := tmp.Name()
	if err := tmp.Close(); err != nil {
		return errors.Join(fmt.Errorf("cover of video %d: %w", videoID, err), os.Remove(tmpName))
	}
	defer func() {
		// Left over only when something failed; after success it was renamed.
		if rmErr := os.Remove(tmpName); rmErr != nil && !errors.Is(rmErr, fs.ErrNotExist) {
			err = errors.Join(err, rmErr)
		}
	}()

	choice := coverChoice{second: chosenSecond}
	if ownImage.Valid {
		choice.own = filepath.Join(c.dataDir, OwnCoversDir, filepath.Base(ownImage.String))
	}
	if choice.beside, choice.besideVersion, err = findBesideImage(file); err != nil {
		return fmt.Errorf("cover of video %d: %w", videoID, err)
	}
	if onlineImage.Valid {
		choice.downloaded = filepath.Join(c.dataDir, online.Dir, filepath.Base(onlineImage.String))
	}
	// A frame picked by FranzPLAY is first looked for among the key frames
	// only. Some videos have no key frame after the moment (a screen
	// recording may have one only at the start): then every frame is read.
	var info os.FileInfo
	for _, keyOnly := range []bool{true, false} {
		args := c.coverArgs(file, duration.Int64, choice, keyOnly, tmpName)
		if _, err := c.run(ctx, c.ffmpeg, args...); err != nil {
			return fmt.Errorf("cover of video %d: %w", videoID, err)
		}
		if info, err = os.Stat(tmpName); err != nil {
			return fmt.Errorf("cover of video %d: %w", videoID, err)
		}
		if info.Size() > 0 || !slices.Contains(args, "-skip_frame") {
			break
		}
	}
	if info.Size() == 0 {
		return fmt.Errorf("cover of video %d: ffmpeg wrote no image", videoID)
	}

	name := chosenCoverName(videoID, fingerprint, choice)
	if err := safefile.Rename(tmpName, filepath.Join(dir, name)); err != nil {
		return fmt.Errorf("cover of video %d: %w", videoID, err)
	}

	// Saved only if the content is still the one we used.
	res, err := c.db.ExecContext(ctx, `UPDATE videos SET cover = ? WHERE id = ? AND fingerprint = ?`,
		name, videoID, fingerprint)
	if err != nil {
		return fmt.Errorf("save cover of video %d: %w", videoID, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("save cover of video %d: %w", videoID, err)
	}
	if n == 0 {
		// The file changed meanwhile: this cover belongs to nobody.
		return removeFile(dir, name)
	}
	if oldCover.Valid && oldCover.String != name {
		return removeFile(dir, oldCover.String)
	}
	return nil
}

// coverArgs builds the ffmpeg command. The administrator's choice comes
// first: an image they uploaded, or a moment of the video. Then a picture
// next to the video if there is one, the picture found on the internet,
// and last a frame of the video
// picked by FranzPLAY. All end as a JPEG coverWidth wide (or smaller, never
// enlarged). Going through ffmpeg also means a file that is not really a
// picture never becomes a cover.
//
// With keyOnly the frame picked by FranzPLAY is the first key frame from
// its moment on (-skip_frame nokey): a key frame is a whole picture, so
// ffmpeg decodes one frame instead of up to ten seconds of video. On a 4K
// film that is about 0.8 seconds instead of 4.5. A moment chosen by the
// administrator is always exact.
func (c *Coverer) coverArgs(video string, duration int64, choice coverChoice, keyOnly bool, out string) []string {
	args := []string{"-v", "error", "-y"}
	scale := "scale='min(" + strconv.Itoa(coverWidth) + ",iw)':-2"
	// A picture is cut to the largest 16:9 rectangle in its middle, like
	// the covers of the grid: a tall poster shows its middle, as on a card.
	const crop = "crop='min(iw,ih*16/9)':'min(ih,iw*9/16)',"
	switch {
	case choice.own != "":
		args = append(args, "-i", "file:"+choice.own)
		scale = crop + scale
	case choice.second.Valid:
		// -ss before -i jumps straight to the moment instead of decoding up to it.
		args = append(args, "-ss", strconv.FormatInt(choice.second.Int64, 10), "-i", "file:"+video)
	case choice.beside != "":
		args = append(args, "-i", "file:"+choice.beside)
		scale = crop + scale
	case choice.downloaded != "":
		args = append(args, "-i", "file:"+choice.downloaded)
	default:
		if keyOnly {
			args = append(args, "-skip_frame", "nokey")
		}
		args = append(args, "-ss", strconv.FormatInt(coverSecond(duration), 10), "-i", "file:"+video)
	}
	return append(args,
		"-frames:v", "1",
		"-vf", scale,
		"-q:v", "3",
		"-f", "image2", "file:"+out)
}

// findBesideImage looks for a picture next to the video, with its name
// (video.CoverImage says which), and returns its full path and version,
// or "" when there is none. It only reads the folder: nothing is written
// there (rule 1).
func findBesideImage(file string) (image, version string, err error) {
	entries, err := os.ReadDir(filepath.Dir(file))
	if errors.Is(err, fs.ErrNotExist) {
		return "", "", nil // the video is gone too: making its cover fails next
	}
	if err != nil {
		return "", "", fmt.Errorf("look for a picture next to the video: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.Type().IsRegular() {
			names = append(names, e.Name())
		}
	}
	name, ok := video.CoverImage(filepath.Base(file), names)
	if !ok {
		return "", "", nil
	}
	image = filepath.Join(filepath.Dir(file), name)
	info, err := os.Stat(image)
	if errors.Is(err, fs.ErrNotExist) {
		return "", "", nil // gone while we looked
	}
	if err != nil {
		return "", "", fmt.Errorf("look for a picture next to the video: %w", err)
	}
	return image, video.ImageVersion(name, info.Size(), info.ModTime().UnixNano()), nil
}

// removeFile deletes a file of the data folder, like a cover. A file
// already gone is fine.
func removeFile(dir, name string) error {
	if err := os.Remove(filepath.Join(dir, filepath.Base(name))); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("remove old %s: %w", name, err)
	}
	return nil
}

// RemoveOrphanCovers deletes the files in the covers folder that no video
// uses any more (videos forgotten after being missing for a long time).
// It only ever looks inside the covers folder of the data folder. It must
// run before the job worker starts, so it never sees a cover being made.
func RemoveOrphanCovers(ctx context.Context, db *sql.DB, dataDir string) (removed int, err error) {
	return removeOrphans(ctx, db, filepath.Join(dataDir, CoversDir), "videos", "cover")
}

// RemoveOrphanOwnCovers deletes the images uploaded as covers that no
// video uses any more. Like RemoveOrphanCovers, it must run before the
// job worker and the web server start.
func RemoveOrphanOwnCovers(ctx context.Context, db *sql.DB, dataDir string) (removed int, err error) {
	return removeOrphans(ctx, db, filepath.Join(dataDir, OwnCoversDir), "videos", "own_cover")
}

// removeOrphans deletes what is in dir and not named in the given column
// of a table: old files, and work left half done by a crash.
func removeOrphans(ctx context.Context, db *sql.DB, dir, table, column string) (removed int, err error) {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("read %s folder: %w", column, err)
	}
	used, err := usedFiles(ctx, db, table, column)
	if err != nil {
		return 0, err
	}
	for _, e := range entries {
		if used[e.Name()] {
			continue
		}
		if e.IsDir() {
			// Only FranzPLAY's own unfinished work: anything else is left alone.
			if !strings.HasPrefix(e.Name(), ".new-") {
				continue
			}
			if err := os.RemoveAll(filepath.Join(dir, e.Name())); err != nil {
				return removed, fmt.Errorf("remove unfinished %s: %w", column, err)
			}
		} else if err := removeFile(dir, e.Name()); err != nil {
			return removed, err
		}
		removed++
	}
	return removed, nil
}

// usedFiles returns the file names in a column of a table: constants of
// this package, never anything a request chose.
func usedFiles(ctx context.Context, db *sql.DB, table, column string) (_ map[string]bool, err error) {
	rows, err := db.QueryContext(ctx, `SELECT `+column+` FROM `+table+` WHERE `+column+` IS NOT NULL`)
	if err != nil {
		return nil, fmt.Errorf("read %s files: %w", column, err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	used := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("read %s files: %w", column, err)
		}
		used[name] = true
	}
	return used, rows.Err()
}
