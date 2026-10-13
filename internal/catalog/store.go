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

	"github.com/FranzGra/FranzPLAY/internal/sharing"
	"github.com/FranzGra/FranzPLAY/internal/users"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// errNotFound means there is no video with that id the person may open.
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
	// FileType describes the file for the browser's canPlayType, like
	// `video/webm; codecs="vp9, opus"`; "" = no browser is worth asking.
	// A browser that can play it may ask for the file instead of the copy.
	FileType string `json:"fileType"`
	Copy     bool   `json:"copy"` // a copy for every device is ready
	Preview  *Preview  `json:"preview"`  // frames for the timeline; null = none yet
	Clip     *string   `json:"clip"`     // address of the seconds that play on the card; null = none yet
	ClipHD   *string   `json:"clipHD"`   // the same clip, sharper, for a good connection; null = none yet
	Format   string    `json:"format"`   // the kind of file, from its name: "MP4", "MKV"; "" = none
	Likes    int64     `json:"likes"`    // how many people like it
	Private  bool      `json:"private"`  // only its uploader, and the people they chose, see it
	Uploader *Person   `json:"uploader"` // who uploaded it from the browser; null = from a video folder
	// Owner is whose video it is, shown under the title: its uploader, or
	// for a video from a folder the main administrator. Only for one video;
	// null if FranzPLAY has nobody yet.
	Owner *Owner `json:"owner,omitempty"`
	// SharedWith are the people a private video is shared with: only for
	// one video, and only when its uploader asks.
	SharedWith []sharing.Person `json:"sharedWith,omitempty"`
	// From a details file next to the video, like yt-dlp's .info.json:
	Author      string  `json:"author"`                // who published it; "" = not known
	PublishedOn *string `json:"publishedOn"`           // "2006-01-02"; null = not known
	Description *string `json:"description,omitempty"` // only for one video; null = none
}

// Person is someone on FranzPLAY, as a video names them.
type Person struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// Owner is the person a video belongs to, with their profile photo.
type Owner struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	Avatar int64  `json:"avatar"` // version of their profile photo, 0 = none
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

// Category is a category with how many videos it has, and the color and
// image the administrator chose for it ("" and nil if none).
type Category struct {
	Name   string  `json:"name"`
	Videos int     `json:"videos"`
	Color  string  `json:"color"`
	Image  *string `json:"image"` // address of the image
}

// store reads the catalog. It never writes: the library scan and the job
// queue are the only writers (rule 4).
type store struct {
	db *sql.DB
}

// watchable says which videos a person may open: the visible ones, and
// the private uploads that are theirs or shared with them, while those are
// on the disk and not hidden. Its one argument is the person, from viewer.
// Lists keep to visible: a private video shows up in no list, not even its
// uploader's; only the list of the videos shared with me (sharedWithMe)
// has them.
const watchable = `(v.visible OR (v.private AND v.missing_since IS NULL AND v.hidden_at IS NULL
	AND ? IN (SELECT v.uploaded_by UNION ALL SELECT s.user_id FROM video_shares s WHERE s.video_id = v.id)))`

// sharedWithMe says which private videos were shared with a person, the
// one argument, while those are on the disk and not hidden.
const sharedWithMe = `(v.private AND v.missing_since IS NULL AND v.hidden_at IS NULL
	AND EXISTS (SELECT 1 FROM video_shares s WHERE s.video_id = v.id AND s.user_id = ?))`

// viewer returns who is asking; 0, nobody, outside a logged-in request.
func viewer(ctx context.Context) int64 {
	a, ok := users.FromContext(ctx)
	if !ok {
		return 0
	}
	return a.ID
}

// shownCategory is the category people see for the video v: the name the
// administrator gave it in the categories table, or the category itself.
// Two categories given the same name show as one.
const shownCategory = `coalesce((SELECT c.label FROM categories c WHERE c.name = v.category), v.category)`

// videoColumns are read for every video, in the order scanVideo expects.
const videoColumns = `v.id, v.shown_title, ` + shownCategory + `, v.duration, v.width, v.height, v.cover, v.added_at,
	v.path, v.video_codec, v.audio_codec, v.pixel_format, v.preview, v.preview_gap, v.preview_count, v.converted,
	v.shown_author, v.shown_published_on, v.clip, v.clip_hd, v.private,
	v.uploaded_by, (SELECT u.name FROM users u WHERE u.id = v.uploaded_by),
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
	var cover, videoCodec, audioCodec, pixels, preview, converted, author, published, clip, clipHD sql.NullString
	var addedAt int64
	var relPath string
	var uploaderID sql.NullInt64
	var uploaderName sql.NullString
	if err := row.Scan(&v.ID, &v.Title, &v.Category, &duration, &width, &height, &cover, &addedAt,
		&relPath, &videoCodec, &audioCodec, &pixels, &preview, &previewGap, &previewCount, &converted,
		&author, &published, &clip, &clipHD, &v.Private, &uploaderID, &uploaderName, &v.Likes); err != nil {
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
	if clipHD.Valid {
		address := "/api/clips-hd/" + clipHD.String
		v.ClipHD = &address
	}
	if uploaderID.Valid && uploaderName.Valid {
		v.Uploader = &Person{ID: uploaderID.Int64, Name: uploaderName.String}
	}
	v.AddedAt = time.Unix(addedAt, 0).UTC()
	v.Format = fileFormat(relPath)
	v.Author = author.String
	if published.Valid {
		v.PublishedOn = &published.String
	}
	info := video.Info{VideoCodec: videoCodec.String, AudioCodec: audioCodec.String, PixelFormat: pixels.String}
	v.Playable = converted.Valid || video.DirectlyPlayable(path.Ext(relPath), info)
	v.FileType = video.BrowserType(path.Ext(relPath), info)
	v.Copy = converted.Valid
	return v, nil
}

// list returns a page of visible videos, newest first, and how many there
// are in total for that query.
func (s store) list(ctx context.Context, q listQuery) (_ []Video, total int, err error) {
	where := `v.visible`
	args := []any{}
	if q.shared {
		where = sharedWithMe
		args = append(args, viewer(ctx))
	}
	if q.category != "" {
		where += ` AND ` + shownCategory + ` = ?`
		args = append(args, q.category)
	}
	if q.uploader != 0 {
		where += ` AND v.uploaded_by = ?`
		args = append(args, q.uploader)
	}
	// LIKE ignores case for the letters A to Z; that is enough for a home search.
	for _, w := range q.words {
		where += ` AND (v.shown_title LIKE ? ESCAPE '\' OR ` + shownCategory + ` LIKE ? ESCAPE '\')`
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

// get returns one video the person may open, with its description.
func (s store) get(ctx context.Context, id int64) (Video, error) {
	var description sql.NullString
	v, err := scanVideo(moreColumns{s.db.QueryRowContext(ctx,
		`SELECT `+videoColumns+`, v.shown_description FROM videos v WHERE v.id = ? AND `+watchable, id, viewer(ctx)),
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
	if v.Owner, err = s.owner(ctx, v.Uploader); err != nil {
		return Video{}, fmt.Errorf("read video %d: %w", id, err)
	}
	if v.Private && v.Uploader != nil && v.Uploader.ID == viewer(ctx) {
		people, err := sharing.People(ctx, s.db, `SELECT s.video_id, u.id, u.name, u.avatar
			FROM video_shares s JOIN users u ON u.id = s.user_id
			WHERE s.video_id = ? ORDER BY u.name COLLATE NOCASE, u.id`, id)
		if err != nil {
			return Video{}, fmt.Errorf("read video %d: %w", id, err)
		}
		v.SharedWith = people[id]
	}
	return v, nil
}

// owner returns whose a video is: the person who uploaded it, or for a
// video from a folder (or whose uploader left) the main administrator, the
// first administrator created, who installed FranzPLAY. nil if there is
// nobody yet.
func (s store) owner(ctx context.Context, uploader *Person) (*Owner, error) {
	var uploaderID any // NULL: the video came from a folder
	if uploader != nil {
		uploaderID = uploader.ID
	}
	var o Owner
	err := s.db.QueryRowContext(ctx, `SELECT u.id, u.name, u.avatar FROM users u WHERE u.id = coalesce(?,
		(SELECT a.id FROM users a WHERE a.role = 'admin' ORDER BY a.created_at, a.id LIMIT 1))`, uploaderID).
		Scan(&o.ID, &o.Name, &o.Avatar)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read owner: %w", err)
	}
	return &o, nil
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

// categories returns the categories that have visible videos, by the
// name people see, with the color and image the administrator chose.
func (s store) categories(ctx context.Context) (_ []Category, err error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT coalesce(c.label, v.category) AS shown, count(*), coalesce(max(c.color), ''), max(c.image)
		FROM videos v LEFT JOIN categories c ON c.name = v.category
		WHERE v.visible AND v.category != ''
		GROUP BY shown ORDER BY shown COLLATE NOCASE`)
	if err != nil {
		return nil, fmt.Errorf("list categories: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := []Category{}
	for rows.Next() {
		var c Category
		var image sql.NullString
		if err := rows.Scan(&c.Name, &c.Videos, &c.Color, &image); err != nil {
			return nil, fmt.Errorf("list categories: %w", err)
		}
		if image.Valid {
			c.Image = categoryImageURL(image.String)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// file returns the full path of the file of a video the person may open.
func (s store) file(ctx context.Context, id int64) (string, error) {
	var root, rel string
	err := s.db.QueryRowContext(ctx, `
		SELECT l.path, v.path FROM videos v JOIN libraries l ON l.id = v.library_id
		WHERE v.id = ? AND `+watchable, id, viewer(ctx)).Scan(&root, &rel)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errNotFound
	}
	if err != nil {
		return "", fmt.Errorf("find video %d: %w", id, err)
	}
	return filepath.Join(root, filepath.FromSlash(rel)), nil
}

// played returns the file the browser gets for a video: the copy made for
// the browsers, in convertedDir, when there is one and original is false;
// else the file itself.
func (s store) played(ctx context.Context, id int64, convertedDir string, original bool) (name string, isCopy bool, err error) {
	var root, rel string
	var converted sql.NullString
	err = s.db.QueryRowContext(ctx, `
		SELECT l.path, v.path, v.converted FROM videos v JOIN libraries l ON l.id = v.library_id
		WHERE v.id = ? AND `+watchable, id, viewer(ctx)).Scan(&root, &rel, &converted)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, errNotFound
	}
	if err != nil {
		return "", false, fmt.Errorf("find video %d: %w", id, err)
	}
	if converted.Valid && !original {
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

// embeddedFile returns the copy of one subtitle inside a video the person
// may open.
func (s store) embeddedFile(ctx context.Context, id int64, stream int) (string, error) {
	var name string
	err := s.db.QueryRowContext(ctx, `SELECT s.file FROM video_subtitles s JOIN videos v ON v.id = s.video_id
		WHERE s.video_id = ? AND s.stream = ? AND `+watchable, id, stream, viewer(ctx)).Scan(&name)
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

// autoFile returns the file of one automatic subtitle of a video the
// person may open.
func (s store) autoFile(ctx context.Context, id int64, lang string) (string, error) {
	var name string
	err := s.db.QueryRowContext(ctx, `SELECT a.file FROM auto_subtitles a JOIN videos v ON v.id = a.video_id
		WHERE a.video_id = ? AND a.lang = ? AND a.fingerprint = v.fingerprint AND `+watchable,
		id, lang, viewer(ctx)).Scan(&name)
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
