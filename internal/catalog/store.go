package catalog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/video"
)

// errNotFound means there is no visible video with that id.
var errNotFound = errors.New("video not found")

// Video is one video as the interface sees it.
type Video struct {
	ID       int64     `json:"id"`
	Title    string    `json:"title"`
	Category string    `json:"category"` // "" = none
	Duration *int64    `json:"duration"` // seconds; null = not read yet
	Width    *int      `json:"width"`    // on screen; null = not read yet
	Height   *int      `json:"height"`   // on screen; null = not read yet
	Cover    *string   `json:"cover"`    // address of the image; null = none yet
	AddedAt  time.Time `json:"addedAt"`  // when FranzPLAY found it
	Playable bool      `json:"playable"` // every browser can play it: as it is, or its copy
	Preview  *Preview  `json:"preview"`  // frames for the timeline; null = none yet
	Clip     *string   `json:"clip"`     // address of the seconds that play on the card; null = none yet
	Format   string    `json:"format"`   // the kind of file, from its name: "MP4", "MKV"; "" = none
	Likes    int64     `json:"likes"`    // how many people like it
	// From a details file next to the video, like yt-dlp's .info.json:
	Author      string  `json:"author"`                // who published it; "" = not known
	PublishedOn *string `json:"publishedOn"`           // "2006-01-02"; null = not known
	Description *string `json:"description,omitempty"` // only for one video; null = none
}

// Preview is the image with small frames of a video, shown over the
// player's timeline: Count frames of Width×Height, one every Gap seconds,
// Columns per row.
type Preview struct {
	Src     string `json:"src"`
	Gap     int64  `json:"gap"` // seconds
	Count   int    `json:"count"`
	Columns int    `json:"columns"`
	Width   int    `json:"width"`
	Height  int    `json:"height"`
}

// Category is a category with how many videos it has.
type Category struct {
	Name   string `json:"name"`
	Videos int    `json:"videos"`
}

// store reads the catalog. It never writes: the library scan and the job
// queue are the only writers (rule 4).
type store struct {
	db *sql.DB
}

// videoColumns are read for every video, in the order scanVideo expects.
const videoColumns = `v.id, v.shown_title, v.category, v.duration, v.width, v.height, v.cover, v.added_at,
	v.path, v.video_codec, v.audio_codec, v.preview, v.preview_gap, v.preview_count, v.converted,
	v.shown_author, v.shown_published_on, v.clip,
	(SELECT count(*) FROM likes l WHERE l.video_id = v.id)`

// rowScanner is a *sql.Row or *sql.Rows.
type rowScanner interface{ Scan(dest ...any) error }

// moreColumns lets scanVideo read a row that has extra columns after the
// usual ones: they go into more.
type moreColumns struct {
	row  rowScanner
	more []any
}

func (m moreColumns) Scan(dest ...any) error { return m.row.Scan(append(dest, m.more...)...) }

func scanVideo(row rowScanner) (Video, error) {
	var v Video
	var duration, width, height, previewGap, previewCount sql.NullInt64
	var cover, videoCodec, audioCodec, preview, converted, author, published, clip sql.NullString
	var addedAt int64
	var relPath string
	if err := row.Scan(&v.ID, &v.Title, &v.Category, &duration, &width, &height, &cover, &addedAt,
		&relPath, &videoCodec, &audioCodec, &preview, &previewGap, &previewCount, &converted,
		&author, &published, &clip, &v.Likes); err != nil {
		return Video{}, err
	}
	if duration.Valid {
		v.Duration = &duration.Int64
	}
	if width.Valid && height.Valid {
		w, h := int(width.Int64), int(height.Int64)
		v.Width, v.Height = &w, &h
	}
	if cover.Valid {
		address := "/api/covers/" + cover.String
		v.Cover = &address
	}
	if preview.Valid && previewGap.Valid && previewCount.Valid {
		count := int(previewCount.Int64)
		columns, _ := video.PreviewGrid(count)
		v.Preview = &Preview{
			Src: "/api/previews/" + preview.String, Gap: previewGap.Int64, Count: count, Columns: columns,
			Width: video.PreviewWidth, Height: video.PreviewHeight,
		}
	}
	if clip.Valid {
		address := "/api/clips/" + clip.String
		v.Clip = &address
	}
	v.AddedAt = time.Unix(addedAt, 0).UTC()
	v.Format = fileFormat(relPath)
	v.Author = author.String
	if published.Valid {
		v.PublishedOn = &published.String
	}
	v.Playable = converted.Valid || video.DirectlyPlayable(path.Ext(relPath),
		video.Info{VideoCodec: videoCodec.String, AudioCodec: audioCodec.String})
	return v, nil
}

// list returns a page of visible videos, newest first, and how many there
// are in total for that query.
func (s store) list(ctx context.Context, q listQuery) (_ []Video, total int, err error) {
	where := `v.visible`
	args := []any{}
	if q.category != "" {
		where += ` AND v.category = ?`
		args = append(args, q.category)
	}
	// LIKE ignores case for the letters A to Z; that is enough for a home search.
	for _, w := range q.words {
		where += ` AND (v.shown_title LIKE ? ESCAPE '\' OR v.category LIKE ? ESCAPE '\')`
		p := likePattern(w)
		args = append(args, p, p)
	}
	if q.shuffle != 0 {
		return s.listShuffled(ctx, where, args, q)
	}
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM videos v WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count videos: %w", err)
	}

	rows, err := s.db.QueryContext(ctx, `SELECT `+videoColumns+` FROM videos v WHERE `+where+`
		ORDER BY v.added_at DESC, v.id DESC LIMIT ? OFFSET ?`, append(args, q.limit, q.offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("list videos: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	videos := []Video{}
	for rows.Next() {
		v, err := scanVideo(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("list videos: %w", err)
		}
		videos = append(videos, v)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("list videos: %w", err)
	}
	return videos, total, nil
}

// listShuffled is list in a mixed order: it reads the ids of all the
// matching videos (a few kilobytes even for thousands of videos), mixes
// them, and reads the videos of the page asked.
func (s store) listShuffled(ctx context.Context, where string, args []any, q listQuery) (_ []Video, total int, err error) {
	rows, err := s.db.QueryContext(ctx, `SELECT v.id FROM videos v WHERE `+where+` ORDER BY v.id`, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list videos: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, 0, fmt.Errorf("list videos: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("list videos: %w", err)
	}
	mixed := shuffled(ids, q.shuffle)
	from := min(q.offset, len(mixed))
	to := min(from+q.limit, len(mixed))
	videos, err := s.byIDs(ctx, mixed[from:to])
	if err != nil {
		return nil, 0, err
	}
	return videos, len(ids), nil
}

// get returns one visible video, with its description.
func (s store) get(ctx context.Context, id int64) (Video, error) {
	var description sql.NullString
	v, err := scanVideo(moreColumns{s.db.QueryRowContext(ctx,
		`SELECT `+videoColumns+`, v.shown_description FROM videos v WHERE v.id = ? AND v.visible`, id),
		[]any{&description}})
	if errors.Is(err, sql.ErrNoRows) {
		return Video{}, errNotFound
	}
	if err != nil {
		return Video{}, fmt.Errorf("read video %d: %w", id, err)
	}
	if description.Valid {
		v.Description = &description.String
	}
	return v, nil
}

// byIDs returns the visible videos among ids, in the order of ids.
func (s store) byIDs(ctx context.Context, ids []int64) (_ []Video, err error) {
	if len(ids) == 0 {
		return []Video{}, nil
	}
	marks := strings.Repeat(",?", len(ids))[1:]
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+videoColumns+` FROM videos v
		WHERE v.visible AND v.id IN (`+marks+`)`, args...)
	if err != nil {
		return nil, fmt.Errorf("read videos: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	found := map[int64]Video{}
	for rows.Next() {
		v, err := scanVideo(rows)
		if err != nil {
			return nil, fmt.Errorf("read videos: %w", err)
		}
		found[v.ID] = v
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read videos: %w", err)
	}
	out := make([]Video, 0, len(found))
	for _, id := range ids {
		if v, ok := found[id]; ok {
			out = append(out, v)
		}
	}
	return out, nil
}

// categories returns the categories that have visible videos, by name.
func (s store) categories(ctx context.Context) (_ []Category, err error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT category, count(*) FROM videos
		WHERE visible AND category != ''
		GROUP BY category ORDER BY category COLLATE NOCASE`)
	if err != nil {
		return nil, fmt.Errorf("list categories: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := []Category{}
	for rows.Next() {
		var c Category
		if err := rows.Scan(&c.Name, &c.Videos); err != nil {
			return nil, fmt.Errorf("list categories: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// file returns the full path of a visible video's file.
func (s store) file(ctx context.Context, id int64) (string, error) {
	var root, rel string
	err := s.db.QueryRowContext(ctx, `
		SELECT l.path, v.path FROM videos v JOIN libraries l ON l.id = v.library_id
		WHERE v.id = ? AND v.visible`, id).Scan(&root, &rel)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errNotFound
	}
	if err != nil {
		return "", fmt.Errorf("find video %d: %w", id, err)
	}
	return filepath.Join(root, filepath.FromSlash(rel)), nil
}

// played returns the file the browser gets for a video: the copy made for
// the browsers, in convertedDir, when there is one; else the file itself.
func (s store) played(ctx context.Context, id int64, convertedDir string) (name string, isCopy bool, err error) {
	var root, rel string
	var converted sql.NullString
	err = s.db.QueryRowContext(ctx, `
		SELECT l.path, v.path, v.converted FROM videos v JOIN libraries l ON l.id = v.library_id
		WHERE v.id = ? AND v.visible`, id).Scan(&root, &rel, &converted)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, errNotFound
	}
	if err != nil {
		return "", false, fmt.Errorf("find video %d: %w", id, err)
	}
	if converted.Valid {
		return filepath.Join(convertedDir, filepath.Base(converted.String)), true, nil
	}
	return filepath.Join(root, filepath.FromSlash(rel)), false, nil
}

// embeddedSubtitle is a subtitle inside a video file, with its copy.
type embeddedSubtitle struct {
	video.EmbeddedSubtitle
	file string // the copy, in the data folder's subtitles/
}

// embedded returns the subtitles inside a video file that were copied
// for the browser, in the order of the file.
func (s store) embedded(ctx context.Context, id int64) (subs []embeddedSubtitle, err error) {
	rows, err := s.db.QueryContext(ctx, `SELECT stream, lang, title, forced, file FROM video_subtitles
		WHERE video_id = ? ORDER BY stream`, id)
	if err != nil {
		return nil, fmt.Errorf("read subtitles of video %d: %w", id, err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		var e embeddedSubtitle
		if err := rows.Scan(&e.Stream, &e.Lang, &e.Title, &e.Forced, &e.file); err != nil {
			return nil, fmt.Errorf("read subtitles of video %d: %w", id, err)
		}
		subs = append(subs, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read subtitles of video %d: %w", id, err)
	}
	return subs, nil
}

// embeddedFile returns the copy of one subtitle inside a visible video.
func (s store) embeddedFile(ctx context.Context, id int64, stream int) (string, error) {
	var name string
	err := s.db.QueryRowContext(ctx, `SELECT s.file FROM video_subtitles s JOIN videos v ON v.id = s.video_id
		WHERE s.video_id = ? AND s.stream = ? AND v.visible`, id, stream).Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errNotFound
	}
	if err != nil {
		return "", fmt.Errorf("find subtitle %d of video %d: %w", stream, id, err)
	}
	return name, nil
}

// autoSubtitle is a subtitle written by whisper, or its translation.
type autoSubtitle struct {
	lang string // "it"
	file string // in the data folder's autosubtitles/
}

// auto returns the automatic subtitles made from the video's current
// content, by language.
func (s store) auto(ctx context.Context, id int64) (subs []autoSubtitle, err error) {
	rows, err := s.db.QueryContext(ctx, `SELECT a.lang, a.file FROM auto_subtitles a JOIN videos v ON v.id = a.video_id
		WHERE a.video_id = ? AND a.fingerprint = v.fingerprint ORDER BY a.lang`, id)
	if err != nil {
		return nil, fmt.Errorf("read automatic subtitles of video %d: %w", id, err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		var a autoSubtitle
		if err := rows.Scan(&a.lang, &a.file); err != nil {
			return nil, fmt.Errorf("read automatic subtitles of video %d: %w", id, err)
		}
		subs = append(subs, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read automatic subtitles of video %d: %w", id, err)
	}
	return subs, nil
}

// autoFile returns the file of one automatic subtitle of a visible video.
func (s store) autoFile(ctx context.Context, id int64, lang string) (string, error) {
	var name string
	err := s.db.QueryRowContext(ctx, `SELECT a.file FROM auto_subtitles a JOIN videos v ON v.id = a.video_id
		WHERE a.video_id = ? AND a.lang = ? AND a.fingerprint = v.fingerprint AND v.visible`, id, lang).Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errNotFound
	}
	if err != nil {
		return "", fmt.Errorf("find automatic subtitle %s of video %d: %w", lang, id, err)
	}
	return name, nil
}

// audio returns the sound tracks inside a video file, in the order of the
// file.
func (s store) audio(ctx context.Context, id int64) (tracks []video.EmbeddedAudio, err error) {
	rows, err := s.db.QueryContext(ctx, `SELECT stream, lang, title, codec, channels, is_default FROM video_audio
		WHERE video_id = ? ORDER BY stream`, id)
	if err != nil {
		return nil, fmt.Errorf("read sound tracks of video %d: %w", id, err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		var a video.EmbeddedAudio
		if err := rows.Scan(&a.Stream, &a.Lang, &a.Title, &a.Codec, &a.Channels, &a.Default); err != nil {
			return nil, fmt.Errorf("read sound tracks of video %d: %w", id, err)
		}
		tracks = append(tracks, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read sound tracks of video %d: %w", id, err)
	}
	return tracks, nil
}
