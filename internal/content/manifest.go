package content

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// Manifest is the video.json of a video's folder: what it takes to put a video
// back together without the database. Files are relative to the folder, with
// "/"; a file still in the old flat folders is not listed.
type Manifest struct {
	Version     int    `json:"version"`
	Fingerprint string `json:"fingerprint"` // the whole of it: says whose the folder is
	Library     string `json:"library,omitempty"`
	Path        string `json:"path"` // inside the library, with "/"
	Title       string `json:"title,omitempty"`
	AddedAt     int64  `json:"addedAt,omitempty"` // Unix seconds
	// SavedAt is when FranzPLAY last changed the file, in Unix seconds: after a
	// restore it says whether the file is newer than the copy. 0: not known.
	SavedAt int64 `json:"savedAt,omitempty"`
	// Access says who may see the video. Missing only in a file written before
	// it was kept here: then nobody can say.
	Access *Access `json:"access,omitempty"`
	// Done are the jobs finished for this content: a job with no file to show
	// (a video too short for a clip, one that plays with no copy) is here too.
	Done       []string   `json:"done,omitempty"`
	Info       *Info      `json:"info,omitempty"`
	Choices    Choices    `json:"choices"`
	CoverImage *string    `json:"coverImage,omitempty"` // version of the picture next to the video
	Cover      *File      `json:"cover,omitempty"`
	Timeline   *Timeline  `json:"timeline,omitempty"`
	Clip       *File      `json:"clip,omitempty"`
	ClipHD     *File      `json:"clipHd,omitempty"`
	Converted  *File      `json:"converted,omitempty"`
	Online     *Online    `json:"online,omitempty"`
	Audio      []Audio    `json:"audio,omitempty"`
	Subtitles  []Subtitle `json:"subtitles,omitempty"`
}

// Access is who may see a video. Links and the people it is shared with are not
// here: without them fewer people see it, never more. An account is a name, since
// an id says nothing to another database.
type Access struct {
	HiddenAt   int64  `json:"hiddenAt,omitempty"` // Unix seconds; 0 = not hidden
	Private    bool   `json:"private"`
	UploadedBy string `json:"uploadedBy,omitempty"`
	// UploadedBySince is when that account was made, in Unix seconds. With the
	// name it tells the same account, come back with a copy of the database, from
	// a new one with the same name.
	UploadedBySince int64 `json:"uploadedBySince,omitempty"`
}

// File is a file of the folder, and the version in its address.
type File struct {
	File    string `json:"file"`
	Version string `json:"version,omitempty"`
}

// Info is what ffprobe read in the video.
type Info struct {
	Duration    int64  `json:"duration"`
	Width       int64  `json:"width,omitempty"`
	Height      int64  `json:"height,omitempty"`
	VideoCodec  string `json:"videoCodec"`
	AudioCodec  string `json:"audioCodec"` // "" = no sound
	Container   string `json:"container,omitempty"`
	PixelFormat string `json:"pixelFormat,omitempty"`
}

// Online is what a source on the internet says about the video.
type Online struct {
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	Author      string `json:"author,omitempty"`
	Date        string `json:"date,omitempty"`
	Image       *File  `json:"image,omitempty"`
}

// Audio is one sound track inside the video file.
type Audio struct {
	Stream   int64  `json:"stream"`
	Lang     string `json:"lang,omitempty"`
	Title    string `json:"title,omitempty"`
	Codec    string `json:"codec,omitempty"`
	Channels int64  `json:"channels,omitempty"`
	Default  bool   `json:"default,omitempty"`
}

// Choices is what the administrator decided for a video.
type Choices struct {
	CoverFile    string  `json:"coverFile,omitempty"`
	CoverVersion string  `json:"coverVersion,omitempty"`
	CoverSecond  *int64  `json:"coverSecond,omitempty"`
	ClipFile     string  `json:"clipFile,omitempty"`
	ClipVersion  string  `json:"clipVersion,omitempty"`
	NoClip       bool    `json:"noClip,omitempty"`
	Title        *string `json:"title,omitempty"`
	Category     *string `json:"category,omitempty"` // "" = no category
}

// Timeline is the image with the frames shown over the player's timeline.
type Timeline struct {
	File    string `json:"file"`
	Version string `json:"version,omitempty"`
	Gap     int64  `json:"gap"` // seconds between two frames
	Count   int64  `json:"count"`
	Width   int64  `json:"width"`
	Height  int64  `json:"height"`
}

// Subtitle is one subtitle of a video. Stream says it was copied from inside
// the video file; Model and TranslatedFrom say how it was made otherwise.
type Subtitle struct {
	File           string `json:"file"`
	Lang           string `json:"lang"`
	Stream         *int64 `json:"stream,omitempty"`
	Title          string `json:"title,omitempty"`
	Forced         bool   `json:"forced,omitempty"`
	Model          string `json:"model,omitempty"`
	TranslatedFrom string `json:"translatedFrom,omitempty"`
	MadeAt         int64  `json:"madeAt,omitempty"`
}

// EnsureVideoFolder returns the code of the folder for a video with the given
// fingerprint, making it the first time, with its video.json filled in.
func EnsureVideoFolder(ctx context.Context, db *sql.DB, r Root, videoID int64, fingerprint string) (string, error) {
	var rel string
	if err := db.QueryRowContext(ctx, `SELECT path FROM videos WHERE id = ?`, videoID).Scan(&rel); err != nil {
		return "", fmt.Errorf("find folder of video %d: %w", videoID, err)
	}
	code, created, err := r.EnsureFolder(fingerprint, rel)
	if err != nil {
		return "", fmt.Errorf("folder of video %d: %w", videoID, err)
	}
	if created {
		if err := SaveManifest(ctx, db, r, videoID); err != nil {
			return "", err
		}
	}
	return code, nil
}

// IfSame runs save in one transaction, only while the video still has the content
// with fingerprint. A job that ends after the file changed writes nothing and
// removes nothing: the folder of the old content may be in use, by another copy
// of the same video or by the same file coming back. The transaction holds the
// write lock from the start, so a scan changing the file waits for save. same is
// false when save did not run.
func IfSame(ctx context.Context, db *sql.DB, videoID int64, fingerprint string, save func(tx *sql.Tx) error) (same bool, err error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("save for video %d: %w", videoID, err)
	}
	defer func() {
		if !same || err != nil {
			err = errors.Join(err, tx.Rollback())
			return
		}
		if err = tx.Commit(); err != nil {
			err = fmt.Errorf("save for video %d: %w", videoID, err)
		}
	}()
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM videos WHERE id = ? AND fingerprint = ?)`,
		videoID, fingerprint).Scan(&same); err != nil {
		return false, fmt.Errorf("save for video %d: %w", videoID, err)
	}
	if !same {
		return false, nil
	}
	return true, save(tx)
}

// querier is a database or a transaction.
type querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// execer is a database or a transaction, for writing.
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// SaveManifest writes again the video.json of a video from the database. A
// video with no folder yet has nothing to write, since its files are all in the
// old flat folders, unless it is hidden or private: that must survive a database
// lost, so such a video gets its folder now.
func SaveManifest(ctx context.Context, db *sql.DB, r Root, videoID int64) error {
	return saveManifest(ctx, db, r, videoID)
}

func saveManifest(ctx context.Context, db querier, r Root, videoID int64) (err error) {
	x := r.index()
	x.manifest.Lock()
	defer x.manifest.Unlock()

	var m Manifest
	var access Access
	var hiddenAt, uploadedSince sql.NullInt64
	var uploadedBy sql.NullString
	var coverSecond, gap, count, width, height, duration, videoWidth, videoHeight sql.NullInt64
	var adminTitle, adminCategory, ownCover, ownClip, preview, coverImage, cover, clip, clipHD, converted sql.NullString
	var videoCodec, audioCodec, container, pixels sql.NullString
	var onlineTitle, onlineDescription, onlineAuthor, onlineDate, onlineImage sql.NullString
	err = db.QueryRowContext(ctx, `
		SELECT v.fingerprint, l.path, v.path, v.shown_title, v.added_at, v.hidden_at, v.private,
		       (SELECT u.name FROM users u WHERE u.id = v.uploaded_by),
		       (SELECT u.created_at FROM users u WHERE u.id = v.uploaded_by), v.admin_title, v.admin_category,
		       v.own_cover, v.cover_second, v.own_clip, v.no_clip,
		       v.preview, v.preview_gap, v.preview_count, v.preview_width, v.preview_height,
		       v.cover_image, v.cover, v.clip, v.clip_hd, v.converted,
		       v.duration, v.width, v.height, v.video_codec, v.audio_codec, v.container, v.pixel_format,
		       v.online_title, v.online_description, v.online_author, v.online_published_on, v.online_cover
		FROM videos v JOIN libraries l ON l.id = v.library_id WHERE v.id = ?`, videoID).
		Scan(&m.Fingerprint, &m.Library, &m.Path, &m.Title, &m.AddedAt, &hiddenAt, &access.Private,
			&uploadedBy, &uploadedSince, &adminTitle, &adminCategory,
			&ownCover, &coverSecond, &ownClip, &m.Choices.NoClip,
			&preview, &gap, &count, &width, &height,
			&coverImage, &cover, &clip, &clipHD, &converted,
			&duration, &videoWidth, &videoHeight, &videoCodec, &audioCodec, &container, &pixels,
			&onlineTitle, &onlineDescription, &onlineAuthor, &onlineDate, &onlineImage)
	if errors.Is(err, sql.ErrNoRows) {
		return nil // forgotten meanwhile
	}
	if err != nil {
		return fmt.Errorf("video.json of video %d: %w", videoID, err)
	}
	access.HiddenAt, access.UploadedBy, access.UploadedBySince = hiddenAt.Int64, uploadedBy.String, uploadedSince.Int64
	m.Access = &access
	code, ok, err := r.FolderOf(m.Fingerprint)
	if err != nil {
		return fmt.Errorf("video.json of video %d: %w", videoID, err)
	}
	if !ok {
		if !access.Private && access.HiddenAt == 0 {
			return nil
		}
		if code, _, err = r.EnsureFolder(m.Fingerprint, m.Path); err != nil {
			return fmt.Errorf("video.json of video %d: %w", videoID, err)
		}
	}
	m.Version = ManifestVersion
	inFolder := func(value string) string {
		if CodeOf(value) != code {
			return ""
		}
		return FileOf(value)
	}
	fileIn := func(value string) *File {
		if file := inFolder(value); file != "" {
			return &File{File: file, Version: Version(value)}
		}
		return nil
	}
	// A job whose file is still in the old flat folders does not count: those
	// files are not reused, so another installation must make it again.
	flat := map[string]bool{}
	for kind, value := range map[string]sql.NullString{
		jobCover: cover, jobPreview: preview, jobClip: clip, jobConvert: converted, jobOnline: onlineImage,
	} {
		flat[kind] = value.Valid && inFolder(value.String) == ""
	}
	m.Choices.CoverFile = inFolder(ownCover.String)
	m.Choices.CoverVersion = Version(ownCover.String)
	m.Choices.ClipFile = inFolder(ownClip.String)
	m.Choices.ClipVersion = Version(ownClip.String)
	if coverSecond.Valid {
		m.Choices.CoverSecond = &coverSecond.Int64
	}
	if adminTitle.Valid {
		m.Choices.Title = &adminTitle.String
	}
	if adminCategory.Valid {
		m.Choices.Category = &adminCategory.String
	}
	if coverImage.Valid {
		m.CoverImage = &coverImage.String
	}
	m.Cover, m.Clip, m.ClipHD, m.Converted = fileIn(cover.String), fileIn(clip.String), fileIn(clipHD.String), fileIn(converted.String)
	if file := fileIn(preview.String); file != nil {
		m.Timeline = &Timeline{File: file.File, Version: file.Version,
			Gap: gap.Int64, Count: count.Int64, Width: width.Int64, Height: height.Int64}
	}
	if videoCodec.Valid {
		m.Info = &Info{Duration: duration.Int64, Width: videoWidth.Int64, Height: videoHeight.Int64,
			VideoCodec: videoCodec.String, AudioCodec: audioCodec.String, Container: container.String, PixelFormat: pixels.String}
	}
	if onlineTitle.Valid || onlineDescription.Valid || onlineAuthor.Valid || onlineDate.Valid || fileIn(onlineImage.String) != nil {
		m.Online = &Online{Title: onlineTitle.String, Description: onlineDescription.String,
			Author: onlineAuthor.String, Date: onlineDate.String, Image: fileIn(onlineImage.String)}
	}
	var flatTrack bool
	if m.Subtitles, flatTrack, err = manifestSubtitles(ctx, db, videoID, inFolder); err != nil {
		return fmt.Errorf("video.json of video %d: %w", videoID, err)
	}
	flat[jobTracks] = flatTrack
	if m.Audio, err = manifestAudio(ctx, db, videoID); err != nil {
		return fmt.Errorf("video.json of video %d: %w", videoID, err)
	}
	if m.Done, err = manifestDone(ctx, db, videoID, flat); err != nil {
		return fmt.Errorf("video.json of video %d: %w", videoID, err)
	}
	if _, ok := r.nameOf(code); !ok {
		return nil // taken away by hand: the next file made makes it again
	}
	// While it writes, the folder keeps its name: a rename would leave the file
	// nowhere.
	x.mu.RLock()
	defer x.mu.RUnlock()
	e, ok := x.folders[code]
	if !ok {
		return nil
	}
	return saveManifestFile(filepath.Join(r.VideoFolders(), e.name), m)
}

// saveManifestFile writes a video.json only when it has something new, so the
// date of the file says when the video last changed. One that cannot be read,
// or written by a newer FranzPLAY, is left as it is.
func saveManifestFile(dir string, m Manifest) error {
	old, err := os.ReadFile(filepath.Join(dir, FileManifest))
	if err == nil {
		before, err := parseManifest(old)
		if err != nil {
			return nil //nolint:nilerr // not ours to touch: nothing is wrong with the job that asked
		}
		m.SavedAt = before.SavedAt
		data, err := encodeManifest(m)
		if err != nil {
			return err
		}
		if bytes.Equal(old, data) {
			return nil
		}
	}
	m.SavedAt = time.Now().Unix()
	return writeManifest(dir, m)
}

// manifestSubtitles lists the subtitles of a video that are in its folder.
// flatTrack says a subtitle of the file is still in the old flat folder.
func manifestSubtitles(ctx context.Context, db querier, videoID int64, inFolder func(string) string) (subs []Subtitle, flatTrack bool, err error) {
	rows, err := db.QueryContext(ctx, `
		SELECT file, lang, stream, title, forced, '', '', 0 FROM video_subtitles WHERE video_id = ?
		UNION ALL
		SELECT a.file, a.lang, NULL, '', 0, a.model, a.translated_from, a.made_at FROM auto_subtitles a
		JOIN videos v ON v.id = a.video_id WHERE a.video_id = ? AND a.fingerprint = v.fingerprint
		ORDER BY 3, 2`, videoID, videoID)
	if err != nil {
		return nil, false, err
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		var s Subtitle
		var stream sql.NullInt64
		var title sql.NullString
		if err := rows.Scan(&s.File, &s.Lang, &stream, &title, &s.Forced, &s.Model, &s.TranslatedFrom, &s.MadeAt); err != nil {
			return nil, false, err
		}
		if s.File = inFolder(s.File); s.File == "" {
			flatTrack = flatTrack || stream.Valid
			continue
		}
		if stream.Valid {
			s.Stream = &stream.Int64
		}
		s.Title = title.String
		subs = append(subs, s)
	}
	return subs, flatTrack, rows.Err()
}

// manifestAudio lists the sound tracks of a video.
func manifestAudio(ctx context.Context, db querier, videoID int64) (tracks []Audio, err error) {
	rows, err := db.QueryContext(ctx, `SELECT stream, lang, title, codec, channels, is_default
		FROM video_audio WHERE video_id = ? ORDER BY stream`, videoID)
	if err != nil {
		return nil, err
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		var a Audio
		if err := rows.Scan(&a.Stream, &a.Lang, &a.Title, &a.Codec, &a.Channels, &a.Default); err != nil {
			return nil, err
		}
		tracks = append(tracks, a)
	}
	return tracks, rows.Err()
}

// The jobs video.json keeps track of, as the queue names them. The queue's
// package uses this one, so the names are written here again.
const (
	jobProbe   = "probe"
	jobOnline  = "online"
	jobCover   = "cover"
	jobPreview = "preview"
	jobClip    = "clip"
	jobTracks  = "tracks"
	jobConvert = "convert"
)

// manifestDone lists in a fixed order the jobs finished for a video, leaving out
// the ones whose work is in the flat folders. A job asked again, even if it was
// done once, is not here until it is done again.
func manifestDone(ctx context.Context, db querier, videoID int64, flat map[string]bool) (done []string, err error) {
	rows, err := db.QueryContext(ctx, `SELECT kind FROM jobs WHERE video_id = ? AND state = 'done'`, videoID)
	if err != nil {
		return nil, err
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	finished := map[string]bool{}
	for rows.Next() {
		var kind string
		if err := rows.Scan(&kind); err != nil {
			return nil, err
		}
		finished[kind] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, kind := range []string{jobProbe, jobOnline, jobCover, jobPreview, jobClip, jobTracks, jobConvert} {
		if finished[kind] && !flat[kind] {
			done = append(done, kind)
		}
	}
	return done, nil
}

// keyAccessSaved is the settings row that says every video.json was written again
// once after they started saying who may see a video.
const keyAccessSaved = "content.access_saved"

// SaveAccess writes the video.json of a video whose access changed. If it cannot,
// every video.json is written again at the next start: a video.json behind the
// database must not open the video after a restore.
func SaveAccess(ctx context.Context, db *sql.DB, r Root, videoID int64) error {
	err := SaveManifest(ctx, db, r, videoID)
	if err != nil {
		if _, delErr := db.ExecContext(ctx, `DELETE FROM settings WHERE key = ?`, keyAccessSaved); delErr != nil {
			err = errors.Join(err, delErr)
		}
	}
	return err
}

// SaveAllManifests writes once the video.json of every video, so that the ones
// made before Access was kept say it too. It looks at each video, and only writes
// what changed: it may take a while on a big library, so it runs in the background,
// and if it stops it starts over at the next start.
func SaveAllManifests(ctx context.Context, db *sql.DB, r Root, logger *slog.Logger) (err error) {
	var done bool
	if err := db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM settings WHERE key = ?)`, keyAccessSaved).Scan(&done); err != nil {
		return fmt.Errorf("write every video.json: %w", err)
	}
	if done {
		return nil
	}
	ids, err := videoIDs(ctx, db)
	if err != nil {
		return fmt.Errorf("write every video.json: %w", err)
	}
	failed := false
	for _, id := range ids {
		if err := SaveManifest(ctx, db, r, id); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			failed = true
			logger.WarnContext(ctx, "write video.json", "video", id, "error", err)
		}
	}
	if failed {
		return nil // tried again at the next start
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO settings (key, value) VALUES (?, '1') ON CONFLICT (key) DO NOTHING`, keyAccessSaved); err != nil {
		return fmt.Errorf("write every video.json: %w", err)
	}
	return nil
}

// videoIDs lists the ids of all the videos.
func videoIDs(ctx context.Context, db querier) (ids []int64, err error) {
	rows, err := db.QueryContext(ctx, `SELECT id FROM videos ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// AfterScan keeps the folders of the videos in line with what a scan found.
//
//   - A video replaced by a new file gets a new folder; the files the
//     administrator chose go with it. The old folder is not used again.
//   - A video moved has its video.json written again.
//   - Every folder takes the name of its video's file. This looks at every
//     video at every scan, without touching the disk unless a name differs, so
//     a rename that failed is tried again.
//
// A problem here is only logged: every file is still found through its code.
func AfterScan(ctx context.Context, db *sql.DB, r Root, moved, replaced []int64, logger *slog.Logger) {
	for _, id := range replaced {
		if err := newFolderForReplaced(ctx, db, r, id); err != nil {
			logger.WarnContext(ctx, "folder of a replaced video", "video", id, "error", err)
		}
	}
	for _, id := range moved {
		if err := SaveManifest(ctx, db, r, id); err != nil {
			logger.WarnContext(ctx, "write video.json of a moved video", "video", id, "error", err)
		}
	}
	if err := followNames(ctx, db, r, logger); err != nil {
		logger.WarnContext(ctx, "names of the video folders", "error", err)
	}
	if err := SaveCategories(ctx, db, r); err != nil {
		logger.WarnContext(ctx, "write "+FileCategories, "error", err)
	}
}

// followNames renames the folders whose video has another file name now.
func followNames(ctx context.Context, db *sql.DB, r Root, logger *slog.Logger) error {
	type present struct{ fingerprint, path string }
	var videos []present
	err := func() (err error) {
		rows, err := db.QueryContext(ctx, `SELECT fingerprint, path FROM videos WHERE missing_since IS NULL`)
		if err != nil {
			return err
		}
		defer func() { err = errors.Join(err, rows.Close()) }()
		for rows.Next() {
			var v present
			if err := rows.Scan(&v.fingerprint, &v.path); err != nil {
				return err
			}
			videos = append(videos, v)
		}
		return rows.Err()
	}()
	if err != nil {
		return err
	}
	for _, v := range videos {
		renamed, err := r.FollowName(v.fingerprint, v.path)
		if err != nil {
			logger.WarnContext(ctx, "rename folder of a video: tried again at the next scan", "path", v.path, "error", err)
			continue
		}
		if renamed {
			logger.InfoContext(ctx, "folder of a video renamed", "path", v.path)
		}
	}
	return nil
}

// newFolderForReplaced makes the folder of a video's new content, and moves
// there the files the administrator chose: they survive a new version of the
// file. What else was in the old folder stays until the jobs have made it
// again, since the pages show it until then.
func newFolderForReplaced(ctx context.Context, db *sql.DB, r Root, videoID int64) error {
	var fingerprint string
	var ownCover, ownClip sql.NullString
	err := db.QueryRowContext(ctx, `SELECT fingerprint, own_cover, own_clip FROM videos WHERE id = ?`, videoID).
		Scan(&fingerprint, &ownCover, &ownClip)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read video %d: %w", videoID, err)
	}
	code, err := EnsureVideoFolder(ctx, db, r, videoID, fingerprint)
	if err != nil {
		return err
	}
	var errs []error
	for _, own := range []struct {
		column string
		value  sql.NullString
	}{{"own_cover", ownCover}, {"own_clip", ownClip}} {
		old, ok := parseStored(own.value.String)
		if !ok || old.code == code {
			continue
		}
		errs = append(errs, r.moveChosen(ctx, db, videoID, own.column, own.value.String, old, code))
	}
	errs = append(errs, SaveManifest(ctx, db, r, videoID))
	return errors.Join(errs...)
}

// moveChosen moves a file the administrator chose to the folder with a code.
// column is one of two constants, never from a request. The file is copied first,
// the row changes only if it still names the old file, and only then the old file
// goes: a stop at any point leaves the row naming a file that is there, and the
// next scan does the rest. A file already there, a newer choice, is not written
// over.
func (r Root) moveChosen(ctx context.Context, db *sql.DB, videoID int64, column, value string, old storedFile, code string) error {
	from := r.FileIn(old.code, old.file)
	to := r.FileIn(code, old.file)
	if _, err := os.Lstat(to); errors.Is(err, fs.ErrNotExist) {
		if err := r.copyInto(code, old.file, from); err != nil {
			return fmt.Errorf("move %s of video %d: %w", column, videoID, err)
		}
	} else if err != nil {
		return fmt.Errorf("move %s of video %d: %w", column, videoID, err)
	}
	res, err := db.ExecContext(ctx, `UPDATE videos SET `+column+` = ? WHERE id = ? AND `+column+` = ?`,
		Stored(code, old.file, old.version), videoID, value)
	if err != nil {
		return fmt.Errorf("move %s of video %d: %w", column, videoID, err)
	}
	if n, err := res.RowsAffected(); err != nil || n == 0 {
		return err // chosen again meanwhile: what is in the new folder is the new choice
	}
	if err := os.Remove(from); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("move %s of video %d: %w", column, videoID, err)
	}
	return nil
}

// copyInto copies a file into the folder with a code, all or nothing.
func (r Root) copyInto(code, file, from string) (err error) {
	in, err := os.Open(from) //nolint:gosec // a file of a video's folder, named by the database
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, in.Close()) }()
	work, err := r.MakeWork()
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(work, ".new-*")
	if err != nil {
		return err
	}
	defer func() {
		if rmErr := os.Remove(tmp.Name()); rmErr != nil && !errors.Is(rmErr, fs.ErrNotExist) {
			err = errors.Join(err, rmErr)
		}
	}()
	if _, err := io.Copy(tmp, in); err != nil {
		return errors.Join(err, tmp.Close())
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return r.Put(code, file, tmp.Name())
}

// RemoveRetiredFolders deletes the folders the database saw lose their video
// (see the table retired_folders): nothing else goes, whatever it looks like. A
// folder the database never heard of may hold hours of work for a video that
// has not arrived yet. A video come back keeps its folder; a folder the database
// still names a file in waits, and is looked at again next time. It must run
// before the job worker and the web server start.
func RemoveRetiredFolders(ctx context.Context, db *sql.DB, r Root, now time.Time) (removed int, err error) {
	due, err := column(ctx, db, `SELECT fingerprint FROM retired_folders WHERE remove_after <= `+
		strconv.FormatInt(now.Unix(), 10))
	if err != nil || len(due) == 0 {
		return 0, err
	}
	if _, err := r.fingerprints(); err != nil { // what is on the disk now
		return 0, err
	}
	known, err := column(ctx, db, `SELECT fingerprint FROM videos`)
	if err != nil {
		return 0, err
	}
	used, err := usedCodes(ctx, db)
	if err != nil {
		return 0, err
	}
	for fingerprint := range due {
		code, ok, err := r.FolderOf(fingerprint)
		switch {
		case err != nil:
			return removed, err
		case ok && !known[fingerprint] && used[code]:
			continue
		case ok && !known[fingerprint]:
			if err := r.removeFolder(code); err != nil {
				return removed, err
			}
			removed++
		}
		if _, err := db.ExecContext(ctx, `DELETE FROM retired_folders WHERE fingerprint = ?`, fingerprint); err != nil {
			return removed, fmt.Errorf("forget a retired folder: %w", err)
		}
	}
	return removed, nil
}

// usedCodes returns the codes of the folders the database names a file in.
func usedCodes(ctx context.Context, db querier) (map[string]bool, error) {
	named, err := column(ctx, db, `
		SELECT cover FROM videos UNION SELECT preview FROM videos UNION SELECT clip FROM videos
		UNION SELECT clip_hd FROM videos UNION SELECT converted FROM videos
		UNION SELECT own_cover FROM videos UNION SELECT own_clip FROM videos
		UNION SELECT online_cover FROM videos UNION SELECT image FROM online_proposals
		UNION SELECT file FROM video_subtitles UNION SELECT file FROM auto_subtitles`)
	if err != nil {
		return nil, err
	}
	used := make(map[string]bool, len(named))
	for value := range named {
		used[CodeOf(value)] = true
	}
	return used, nil
}

// column reads one column of text, leaving out what is NULL. query is one of
// the constants of this file.
func column(ctx context.Context, db querier, query string) (_ map[string]bool, err error) {
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("read what the database names: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	values := map[string]bool{}
	for rows.Next() {
		var v sql.NullString
		if err := rows.Scan(&v); err != nil {
			return nil, fmt.Errorf("read what the database names: %w", err)
		}
		if v.Valid {
			values[v.String] = true
		}
	}
	return values, rows.Err()
}
