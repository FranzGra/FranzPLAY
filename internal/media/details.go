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
// like the .info.json yt-dlp writes or the .nfo of Kodi and Jellyfin. It only reads: nothing is written
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

// errDetailsTooBig means a details file is far bigger than one should be.
var errDetailsTooBig = errors.New("details file too big")

// detailsFiles are the files next to a video that say what it is, best
// first: what the first one knows wins, the others fill the gaps.
var detailsFiles = []struct {
	suffix  string
	maxSize int
	parse   func([]byte) (video.Details, error)
}{
	{video.InfoJSONSuffix, video.MaxInfoJSONSize, video.ParseInfoJSON}, // yt-dlp
	{video.NFOSuffix, video.MaxNFOSize, video.ParseNFO},                // Kodi and Jellyfin
}

// readDetails reads the details files next to a video file; no file means
// no details. A file that cannot be understood is a permanent failure:
// trying again would read the same file.
func readDetails(videoFile string) (video.Details, error) {
	base := strings.TrimSuffix(videoFile, filepath.Ext(videoFile))
	var all video.Details
	for _, f := range detailsFiles {
		details, err := readDetailsFile(base+f.suffix, f.maxSize, f.parse)
		if err != nil {
			return video.Details{}, err
		}
		all = all.Or(details)
	}
	return all, nil
}

// readDetailsFile reads one details file, if it is there.
func readDetailsFile(name string, maxSize int, parse func([]byte) (video.Details, error)) (video.Details, error) {
	f, err := os.Open(name)
	if errors.Is(err, fs.ErrNotExist) {
		return video.Details{}, nil
	}
	if err != nil {
		return video.Details{}, err
	}
	data, err := io.ReadAll(io.LimitReader(f, int64(maxSize)+1))
	err = errors.Join(err, f.Close())
	if err != nil {
		return video.Details{}, err
	}
	if len(data) > maxSize {
		return video.Details{}, fmt.Errorf("%s: %w: %w", filepath.Base(name), errDetailsTooBig, jobs.ErrPermanent)
	}
	details, err := parse(data)
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
