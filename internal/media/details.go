package media

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// Detailer reads the files next to the videos that say what they are,
// like the .info.json yt-dlp writes. It only reads: nothing is written
// next to the videos (rule 1).
type Detailer struct {
	db *sql.DB
}

// NewDetailer returns a detailer for the catalog in db.
func NewDetailer(db *sql.DB) *Detailer {
	return &Detailer{db: db}
}

// Handle is the job handler for jobs.Details. With no details file the
// video keeps the title made from its name, and details read before (from
// a file now gone) are forgotten.
func (d *Detailer) Handle(ctx context.Context, videoID int64) error {
	file, fingerprint, err := locate(ctx, d.db, videoID)
	if err != nil {
		return err
	}
	details, err := readDetails(file)
	if err != nil {
		return fmt.Errorf("details of video %d: %w", videoID, err)
	}
	// Saved only if the content is still the one we looked at.
	_, err = d.db.ExecContext(ctx, `UPDATE videos SET details_title = ?, description = ?, author = ?, published_on = ?
		WHERE id = ? AND fingerprint = ?`,
		orNull(details.Title), orNull(details.Description), orNull(details.Author), orNull(details.Date),
		videoID, fingerprint)
	if err != nil {
		return fmt.Errorf("save details of video %d: %w", videoID, err)
	}
	return nil
}

// errDetailsTooBig means a details file is far bigger than yt-dlp writes.
var errDetailsTooBig = errors.New("details file too big")

// readDetails reads the details file next to a video file; no file means
// no details. A file that cannot be understood is a permanent failure:
// trying again would read the same file.
func readDetails(videoFile string) (video.Details, error) {
	name := strings.TrimSuffix(videoFile, filepath.Ext(videoFile)) + video.InfoJSONSuffix
	f, err := os.Open(name)
	if errors.Is(err, fs.ErrNotExist) {
		return video.Details{}, nil
	}
	if err != nil {
		return video.Details{}, err
	}
	data, err := io.ReadAll(io.LimitReader(f, video.MaxInfoJSONSize+1))
	err = errors.Join(err, f.Close())
	if err != nil {
		return video.Details{}, err
	}
	if len(data) > video.MaxInfoJSONSize {
		return video.Details{}, fmt.Errorf("%s: %w: %w", filepath.Base(name), errDetailsTooBig, jobs.ErrPermanent)
	}
	details, err := video.ParseInfoJSON(data)
	if err != nil {
		return video.Details{}, fmt.Errorf("%s: %w: %w", filepath.Base(name), err, jobs.ErrPermanent)
	}
	return details, nil
}

// orNull stores "" as NULL: the database refuses empty details.
func orNull(s string) any {
	if s == "" {
		return nil
	}
	return s
}
