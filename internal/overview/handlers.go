package overview

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/users"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// Settings are what the summary needs to know about this FranzPLAY.
type Settings struct {
	Version   string
	DataDir   string
	Libraries []string
	Tools     bool // ffmpeg and ffprobe were found
}

// Routes adds the summary for administrators:
//
//	GET /api/overview   numbers, disks and what needs attention
func Routes(db *sql.DB, s Settings, logger *slog.Logger) func(mux *http.ServeMux) {
	a := api{db: db, settings: s, logger: logger, account: users.FromContext, disk: diskSpace, inContainer: inContainer()}
	return a.routes
}

func (a api) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/overview", a.handleGet)
}

type api struct {
	db       *sql.DB
	settings Settings
	logger   *slog.Logger
	account  func(context.Context) (users.Account, bool)
	disk     func(dir string) (total, free uint64, err error)
	// inContainer: the paths of the video folders are the container's.
	inContainer bool
}

// inContainer says FranzPLAY runs in a container, by the files Docker and
// Podman leave in it.
func inContainer() bool {
	for _, sign := range []string{"/.dockerenv", "/run/.containerenv"} {
		if _, err := os.Stat(sign); err == nil {
			return true
		}
	}
	return false
}

func (a api) handleGet(w http.ResponseWriter, r *http.Request) {
	who, ok := a.account(r.Context())
	if !ok {
		respond.Error(w, r, a.logger, http.StatusUnauthorized, "login required")
		return
	}
	if who.Role != users.Admin {
		respond.Error(w, r, a.logger, http.StatusForbidden, "administrators only")
		return
	}
	o, err := a.build(r.Context())
	if err != nil {
		respond.InternalError(w, r, a.logger, err)
		return
	}
	respond.JSON(w, r, a.logger, http.StatusOK, o)
}

// build reads every number of the summary.
func (a api) build(ctx context.Context) (Overview, error) {
	o := Overview{Version: a.settings.Version, Disks: a.disks(ctx), InContainer: a.inContainer}
	var err error
	if o.Videos, err = countVideos(ctx, a.db); err != nil {
		return Overview{}, err
	}
	if o.Damaged, err = damagedFiles(ctx, a.db); err != nil {
		return Overview{}, err
	}
	err = a.db.QueryRowContext(ctx, `
		SELECT
			(SELECT count(DISTINCT coalesce(c.label, v.category)) FROM videos v
			 LEFT JOIN categories c ON c.name = v.category WHERE v.visible AND v.category != ''),
			(SELECT count(*) FROM users),
			(SELECT count(*) FROM users WHERE role = 'admin'),
			(SELECT count(*) FROM comments),
			(SELECT count(*) FROM jobs WHERE state IN ('pending', 'running')),
			(SELECT count(*) FROM jobs WHERE state = 'failed')`).
		Scan(&o.Categories, &o.People, &o.Admins, &o.Comments, &o.Jobs.Waiting, &o.Jobs.Failed)
	if err != nil {
		return Overview{}, fmt.Errorf("read overview: %w", err)
	}
	o.Problems = findProblems(o, a.settings.Tools)
	return o, nil
}

// disks reads the space of the data folder and of each video folder. A
// folder that cannot be read is told, not hidden: it may be a disk that
// is not mounted.
func (a api) disks(ctx context.Context) []Disk {
	folders := append([]string{a.settings.DataDir}, a.settings.Libraries...)
	out := make([]Disk, 0, len(folders))
	for i, f := range folders {
		d := Disk{Folder: f, Data: i == 0}
		total, free, err := a.disk(f)
		if err != nil {
			a.logger.WarnContext(ctx, "read disk space", "folder", f, "error", err)
			d.Error = true
		} else {
			d.Total, d.Free = total, free
		}
		out = append(out, d)
	}
	return out
}

// damagedFiles lists the files FranzPLAY cannot read, in the order of their
// paths, so the same folder stays together.
func damagedFiles(ctx context.Context, db *sql.DB) (_ []DamagedFile, err error) {
	rows, err := db.QueryContext(ctx, `
		SELECT v.id, v.shown_title, l.path, v.path, v.size, `+jobs.FileUnreadableError+`
		FROM videos v JOIN libraries l ON l.id = v.library_id
		WHERE `+jobs.FileUnreadable+`
		ORDER BY l.path, v.path LIMIT ?`, maxDamaged)
	if err != nil {
		return nil, fmt.Errorf("list damaged files: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := []DamagedFile{}
	for rows.Next() {
		var f DamagedFile
		var folder, inside, readError string
		if err := rows.Scan(&f.ID, &f.Title, &folder, &inside, &f.Size, &readError); err != nil {
			return nil, fmt.Errorf("list damaged files: %w", err)
		}
		f.Path = filepath.Join(folder, filepath.FromSlash(inside))
		f.Kind, f.Detail = video.FileProblem(readError)
		out = append(out, f)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list damaged files: %w", err)
	}
	return out, nil
}

// countVideos counts the videos. Whether a video plays in every browser
// is decided by the same rule the player uses (video.DirectlyPlayable).
func countVideos(ctx context.Context, db *sql.DB) (_ Videos, err error) {
	rows, err := db.QueryContext(ctx, `
		SELECT v.path, v.missing_since IS NOT NULL, v.hidden_at IS NOT NULL, v.video_codec,
		       coalesce(v.audio_codec, ''), coalesce(v.pixel_format, ''), v.converted IS NOT NULL, v.cover IS NOT NULL,
		       v.too_short, `+jobs.FileUnreadable+`
		FROM videos v`)
	if err != nil {
		return Videos{}, fmt.Errorf("count videos: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	var v Videos
	for rows.Next() {
		var p string
		var missing, hidden, converted, cover, short, unreadable bool
		var codec sql.NullString
		var audio, pixels string
		if err := rows.Scan(&p, &missing, &hidden, &codec, &audio, &pixels, &converted, &cover, &short, &unreadable); err != nil {
			return Videos{}, fmt.Errorf("count videos: %w", err)
		}
		if missing {
			v.Missing++
			continue
		}
		v.Present++
		// The same three parts as the pills of the list of videos.
		switch {
		case unreadable:
			v.Problems++
		case short:
			v.Short++
		default:
			v.Eligible++
		}
		if hidden {
			v.Hidden++
		}
		if !codec.Valid {
			continue // not analysed yet
		}
		v.Analysed++
		info := video.Info{VideoCodec: codec.String, AudioCodec: audio, PixelFormat: pixels}
		if converted || video.DirectlyPlayable(path.Ext(p), info) {
			v.Playable++
		}
		if !cover {
			v.NoCover++
		}
	}
	if err := rows.Err(); err != nil {
		return Videos{}, fmt.Errorf("count videos: %w", err)
	}
	return v, nil
}
