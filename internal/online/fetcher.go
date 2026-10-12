package online

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// Dir is the folder, inside the data folder, that holds the pictures
// downloaded from the internet. The cover job turns them into covers.
const Dir = "online"

// askTimeout is how long one question to a source may take.
const askTimeout = 20 * time.Second

// Fetcher is the job handler that asks the sources turned on.
type Fetcher struct {
	db      *sql.DB
	dataDir string
	youtube youTube
	tmdb    tmdb
	tpdb    tpdb
	now     func() time.Time
}

// NewFetcher returns a fetcher that writes pictures in dataDir/online.
func NewFetcher(db *sql.DB, dataDir string) *Fetcher {
	client := &http.Client{Timeout: askTimeout}
	return &Fetcher{
		db:      db,
		dataDir: dataDir,
		youtube: youTube{client: client, oEmbed: "https://www.youtube.com/oembed", images: "https://i.ytimg.com/vi"},
		tmdb:    newTMDB(client),
		tpdb:    newTPDB(client),
		now:     time.Now,
	}
}

// errVideoGone means the video was forgotten before its job ran.
var errVideoGone = errors.New("video no longer in the catalog")

// Handle is the job handler for jobs.Online. The name of the file says
// which source knows the video: a YouTube code goes to YouTube, a film's
// title and year to TMDB, every other video to ThePornDB, by a
// fingerprint of the file. With that source off nothing is asked, and
// what was found before is kept. With it on, what it finds replaces what
// was there; finding nothing clears it.
func (f *Fetcher) Handle(ctx context.Context, videoID int64) error {
	s, err := loadSettings(ctx, f.db)
	if err != nil {
		return err
	}
	if !s.YouTube && !s.TMDB && !s.TPDB {
		return nil
	}
	var root, rel, fingerprint string
	var oldImage sql.NullString
	var missing bool
	err = f.db.QueryRowContext(ctx, `
		SELECT l.path, v.path, v.fingerprint, v.online_cover, v.missing_since IS NOT NULL
		FROM videos v JOIN libraries l ON l.id = v.library_id
		WHERE v.id = ?`, videoID).Scan(&root, &rel, &fingerprint, &oldImage, &missing)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("video %d: %w: %w", videoID, errVideoGone, jobs.ErrPermanent)
	}
	if err != nil {
		return fmt.Errorf("read video %d: %w", videoID, err)
	}

	var what found
	if id, ok := video.YouTubeID(rel); ok {
		if !s.YouTube {
			return nil
		}
		what, _, err = f.youtube.lookup(ctx, id)
	} else if film, ok := video.FilmInName(rel); ok {
		if !s.TMDB || s.tmdbKey == "" {
			return nil
		}
		what, _, err = f.tmdb.lookup(ctx, s.tmdbKey, film)
	} else {
		if !s.TPDB || s.tpdbKey == "" {
			return nil
		}
		if missing {
			// Not permanent: if the disk comes back, so does the video.
			return fmt.Errorf("video %d: %w", videoID, errVideoMissing)
		}
		var hash string
		if hash, err = osHash(filepath.Join(root, filepath.FromSlash(rel))); err != nil {
			return fmt.Errorf("video %d: %w", videoID, err)
		}
		what, _, err = f.tpdb.lookup(ctx, s.tpdbKey, hash)
	}
	if errors.Is(err, errKeyRefused) {
		// Trying again cannot help: saving a new key asks again.
		return fmt.Errorf("video %d: %w: %w", videoID, err, jobs.ErrPermanent)
	}
	if err != nil {
		return err
	}
	return f.save(ctx, videoID, fingerprint, oldImage.String, what)
}

// errVideoMissing means the video's file is not where it was last seen.
var errVideoMissing = errors.New("video file currently missing")

// osHash computes the OSHash of a video file, opened only to read.
func osHash(file string) (_ string, err error) {
	r, err := os.Open(file)
	if err != nil {
		return "", fmt.Errorf("fingerprint for ThePornDB: %w", err)
	}
	defer func() { err = errors.Join(err, r.Close()) }()
	info, err := r.Stat()
	if err != nil {
		return "", fmt.Errorf("fingerprint for ThePornDB: %w", err)
	}
	return video.OSHash(r, info.Size())
}

// save writes what was found: the picture in the data folder, the rest in
// the catalog, and asks for a new cover when the picture changed.
func (f *Fetcher) save(ctx context.Context, videoID int64, fingerprint, oldImage string, what found) (err error) {
	dir := filepath.Join(f.dataDir, Dir)
	image := ""
	if what.image != nil {
		image = imageName(videoID, fingerprint)
		if err := writeAtomically(dir, image, what.image); err != nil {
			return fmt.Errorf("picture of video %d: %w", videoID, err)
		}
	}
	saved, err := f.record(ctx, videoID, fingerprint, what.details, image, image != "" || oldImage != "")
	if err != nil {
		return errors.Join(err, removeNew(dir, image, oldImage))
	}
	if !saved {
		// The file changed meanwhile: this picture belongs to nobody.
		return removeNew(dir, image, oldImage)
	}
	if oldImage != "" && oldImage != image {
		return removeFile(dir, oldImage)
	}
	return nil
}

// removeNew removes a picture just written, unless it is the old one
// rewritten in place.
func removeNew(dir, image, oldImage string) error {
	if image == "" || image == oldImage {
		return nil
	}
	return removeFile(dir, image)
}

// record writes the details in the catalog, if the video still has the
// content that was asked about, and asks for a new cover when told to.
// All or nothing.
func (f *Fetcher) record(ctx context.Context, videoID int64, fingerprint string, d video.Details,
	image string, newCover bool) (saved bool, err error) {
	tx, err := f.db.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("save online details of video %d: %w", videoID, err)
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, tx.Rollback())
			return
		}
		err = tx.Commit()
	}()
	res, err := tx.ExecContext(ctx, `
		UPDATE videos SET online_title = ?, online_description = ?, online_author = ?,
		       online_published_on = ?, online_cover = ?
		WHERE id = ? AND fingerprint = ?`,
		orNull(d.Title), orNull(d.Description), orNull(d.Author), orNull(d.Date), orNull(image),
		videoID, fingerprint)
	if err != nil {
		return false, fmt.Errorf("save online details of video %d: %w", videoID, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("save online details of video %d: %w", videoID, err)
	}
	if n == 0 {
		return false, nil
	}
	if newCover {
		// A new picture, or none any more: the cover is made again.
		if err := jobs.Enqueue(ctx, tx, videoID, jobs.Cover, false, f.now()); err != nil {
			return false, err
		}
	}
	return true, nil
}

// imageName is the picture file of a video. It changes when the content
// changes, like the cover's.
func imageName(videoID int64, fingerprint string) string {
	tail := fingerprint[max(0, len(fingerprint)-8):]
	return strconv.FormatInt(videoID, 10) + "-" + tail + ".img"
}

// writeAtomically writes a file of the data folder all or nothing (rule 6):
// a temporary file, renamed only once complete.
func writeAtomically(dir, name string, data []byte) (err error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".new-*")
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, os.Remove(tmp.Name()))
		}
	}()
	if _, err := tmp.Write(data); err != nil {
		return errors.Join(err, tmp.Close())
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), filepath.Join(dir, name))
}

// removeFile deletes a file of the data folder; a file already gone is fine.
func removeFile(dir, name string) error {
	if err := os.Remove(filepath.Join(dir, filepath.Base(name))); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("remove old %s: %w", name, err)
	}
	return nil
}

// orNull stores "" as NULL: the database refuses empty details.
func orNull(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// RemoveOrphans deletes the pictures no video uses any more, and work left
// half done by a crash. It only ever looks inside the data folder's online
// folder, and must run before the job worker starts.
func RemoveOrphans(ctx context.Context, db *sql.DB, dataDir string) (removed int, err error) {
	dir := filepath.Join(dataDir, Dir)
	entries, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("read online folder: %w", err)
	}
	used := map[string]bool{}
	rows, err := db.QueryContext(ctx, `SELECT online_cover FROM videos WHERE online_cover IS NOT NULL`)
	if err != nil {
		return 0, fmt.Errorf("read online pictures: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return 0, fmt.Errorf("read online pictures: %w", err)
		}
		used[name] = true
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("read online pictures: %w", err)
	}
	for _, e := range entries {
		if used[e.Name()] || !e.Type().IsRegular() {
			continue
		}
		if err := removeFile(dir, e.Name()); err != nil {
			return removed, err
		}
		removed++
	}
	return removed, nil
}
