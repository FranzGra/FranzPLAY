package oldimport

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/FranzGra/FranzPLAY/internal/progress"
	"github.com/FranzGra/FranzPLAY/internal/site"
	"github.com/FranzGra/FranzPLAY/internal/users"
)

// ErrNoVideos means the new FranzPLAY has not found its videos yet: the
// import would find no video to attach likes and comments to.
var ErrNoVideos = errors.New("FranzPLAY has no videos yet: start it once with the video folders set, wait for the videos to appear, then import")

// Options are the choices of whoever runs the import.
type Options struct {
	// Try runs everything and writes the report, but saves nothing.
	Try bool
	// Now is the time of the import; zero means the clock.
	Now time.Time
	// PhotosDir is the old FranzPLAY's folder of profile photos
	// (App_Data/User_Images); empty leaves the photos out.
	PhotosDir string
	// DataDir is the new FranzPLAY's data folder, where photos go.
	DataDir string
}

// Import reads the old database from an SQL file and adds what it holds
// to the new FranzPLAY. It is safe to run more than once: what is already
// there is not added again. Everything is saved in one transaction, all
// or nothing (rule 6).
func Import(ctx context.Context, db *sql.DB, file io.Reader, opt Options) (*Report, error) {
	dump, err := Read(file, oldTables...)
	if err != nil {
		return nil, err
	}
	old, err := readOld(dump)
	if err != nil {
		return nil, err
	}
	if opt.Now.IsZero() {
		opt.Now = time.Now()
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("import: %w", err)
	}
	im := importer{ctx: ctx, db: db, tx: tx, old: old, now: opt.Now, photosDir: opt.PhotosDir,
		report: &Report{Try: opt.Try, Problems: old.problems}}
	err = im.run()
	if err == nil && !opt.Try {
		if err := tx.Commit(); err != nil {
			return nil, fmt.Errorf("import: save: %w", err)
		}
		// Photos are files: they come once the people are saved.
		if opt.PhotosDir != "" {
			if err := im.photos(opt.PhotosDir, opt.DataDir); err != nil {
				return nil, err
			}
		}
		return im.report, nil
	}
	if err == nil && opt.PhotosDir != "" {
		err = im.photos(opt.PhotosDir, opt.DataDir) // a try only reads them
	}
	if rbErr := tx.Rollback(); rbErr != nil {
		return nil, errors.Join(err, fmt.Errorf("import: rollback: %w", rbErr))
	}
	if err != nil {
		return nil, err
	}
	return im.report, nil
}

type importer struct {
	ctx    context.Context
	db     *sql.DB
	tx     *sql.Tx
	old    *oldData
	now    time.Time
	report *Report
	// photosDir is where the old photos are; "" = they are left out.
	photosDir string

	userOf  map[int64]int64 // old user id → new user id
	videoOf map[int64]int64 // old video id → new video id
}

func (im *importer) run() error {
	for _, step := range []func() error{
		im.videos, im.users, im.likes, im.comments, im.saved, im.history, im.logins, im.look, im.leftOut,
	} {
		if err := step(); err != nil {
			return err
		}
	}
	return nil
}

func (im *importer) exec(query string, args ...any) (sql.Result, error) {
	return im.tx.ExecContext(im.ctx, query, args...)
}

// added reports whether an INSERT … ON CONFLICT DO NOTHING added its row.
func added(res sql.Result) (bool, error) {
	n, err := res.RowsAffected()
	return n > 0, err
}

func (im *importer) videos() (err error) {
	rows, err := im.tx.QueryContext(im.ctx, `SELECT id, path FROM videos WHERE missing_since IS NULL`)
	if err != nil {
		return fmt.Errorf("import: read videos: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	var current []newVideo
	for rows.Next() {
		var v newVideo
		if err := rows.Scan(&v.id, &v.path); err != nil {
			return fmt.Errorf("import: read videos: %w", err)
		}
		current = append(current, v)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("import: read videos: %w", err)
	}
	if len(current) == 0 {
		return ErrNoVideos
	}
	m := matchVideos(im.old.videos, current)
	im.videoOf = m.byOld
	r := &im.report.Videos
	r.Old, r.Found = len(im.old.videos), len(m.byOld)
	for _, v := range m.missing {
		r.Missing = append(r.Missing, v.path)
	}
	for _, v := range m.ambiguous {
		r.Ambiguous = append(r.Ambiguous, v.path)
	}
	return nil
}

func (im *importer) users() error {
	im.userOf = map[int64]int64{}
	r := &im.report.People
	// Two old names can give the same new one ("Al" and "Al_"): the
	// second gets a number, so two people are never joined into one.
	taken := map[string]bool{}
	for _, u := range im.old.users {
		name, renamed := newName(u.name)
		for i := 2; taken[strings.ToLower(name)]; i++ {
			name, renamed = numbered(newNameBase(u.name), i), true
		}
		taken[strings.ToLower(name)] = true
		var id int64
		err := im.tx.QueryRowContext(im.ctx, `SELECT id FROM users WHERE name = ?`, name).Scan(&id)
		switch {
		case err == nil:
			// Already there: made by an earlier import, or the same person
			// set up the new FranzPLAY. Their password and role stay.
			im.userOf[u.id] = id
			r.Existing = append(r.Existing, name)
			continue
		case !errors.Is(err, sql.ErrNoRows):
			return fmt.Errorf("import: find user %s: %w", name, err)
		}

		role := users.User
		if u.admin {
			role = users.Admin
		}
		var color any // NULL = FranzPLAY's own
		if c, err := users.ParseColor(u.color); err == nil && c != "" {
			color = string(c)
		}
		var lastLogin any
		if !u.lastLogin.IsZero() {
			lastLogin = u.lastLogin.Unix()
		}
		res, err := im.exec(`INSERT INTO users (name, password_hash, role, can_upload, accent_color, last_login, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`, name, u.hash, string(role), u.admin, color, lastLogin, im.now.Unix())
		if err != nil {
			return fmt.Errorf("import: add user %s: %w", name, err)
		}
		if id, err = res.LastInsertId(); err != nil {
			return fmt.Errorf("import: add user %s: %w", name, err)
		}
		im.userOf[u.id] = id
		for _, row := range u.closedRows {
			if _, err := im.exec(`INSERT INTO closed_home_rows (user_id, row) VALUES (?, ?) ON CONFLICT DO NOTHING`, id, row); err != nil {
				return fmt.Errorf("import: home rows of %s: %w", name, err)
			}
		}
		r.Added = append(r.Added, name)
		if renamed {
			r.Renamed = append(r.Renamed, Renamed{Old: u.name, New: name})
		}
		if !strings.HasPrefix(u.hash, "$2") {
			r.NoPassword = append(r.NoPassword, name)
		}
	}
	return nil
}

// newName returns a name the new FranzPLAY accepts. The old one allowed
// names the new one does not ("Al", "anna@casa"): signs become "_" and a
// short name is lengthened, so the person can still be recognized.
func newName(old string) (string, bool) {
	if clean, err := users.CleanName(old); err == nil {
		return clean, clean != strings.TrimSpace(old)
	}
	var sb strings.Builder
	for _, r := range strings.TrimSpace(old) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || strings.ContainsRune("._-", r) {
			sb.WriteRune(r)
		} else {
			sb.WriteRune('_')
		}
	}
	name := sb.String()
	for utf8.RuneCountInString(name) < 3 {
		name += "_"
	}
	if utf8.RuneCountInString(name) > 32 {
		name = string([]rune(name)[:32])
	}
	return name, true
}

// newNameBase is the name before any number is added.
func newNameBase(old string) string {
	name, _ := newName(old)
	return name
}

// numbered adds "_2", "_3"… to a name, keeping it within 32 characters.
func numbered(name string, i int) string {
	suffix := fmt.Sprintf("_%d", i)
	runes := []rune(name)
	if limit := 32 - len(suffix); len(runes) > limit {
		runes = runes[:limit]
	}
	return string(runes) + suffix
}

// pair finds the new user and video of an old row; ok is false when
// either is not in the new FranzPLAY.
func (im *importer) pair(user, video int64) (int64, int64, bool) {
	u, okU := im.userOf[user]
	v, okV := im.videoOf[video]
	return u, v, okU && okV
}

// when returns t, or the time of the import when the old row had none.
func (im *importer) when(t time.Time) int64 {
	if t.IsZero() {
		return im.now.Unix()
	}
	return t.Unix()
}

func (im *importer) likes() error {
	r := &im.report.Likes
	for _, l := range im.old.likes {
		user, video, ok := im.pair(l.user, l.video)
		if !ok {
			r.Skipped++
			continue
		}
		res, err := im.exec(`INSERT INTO likes (user_id, video_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
			user, video, im.when(l.at))
		if err != nil {
			return fmt.Errorf("import: like: %w", err)
		}
		if ok, err := added(res); err != nil {
			return fmt.Errorf("import: like: %w", err)
		} else if ok {
			r.Added++
		} else {
			r.Existing++
		}
	}
	return nil
}

// maxComment is the longest comment of the new FranzPLAY, in characters.
const maxComment = 2000

func (im *importer) comments() error {
	r := &im.report.Comments
	for _, c := range im.old.comments {
		user, video, ok := im.pair(c.user, c.video)
		if !ok {
			r.Skipped++
			continue
		}
		body := strings.TrimSpace(strings.ToValidUTF8(c.body, "�"))
		if body == "" {
			r.Empty++
			continue
		}
		shortened := utf8.RuneCountInString(body) > maxComment
		if shortened {
			body = string([]rune(body)[:maxComment-1]) + "…"
		}
		at := im.when(c.at)
		var n int
		if err := im.tx.QueryRowContext(im.ctx, `SELECT count(*) FROM comments
			WHERE video_id = ? AND user_id = ? AND body = ? AND created_at = ?`, video, user, body, at).Scan(&n); err != nil {
			return fmt.Errorf("import: comment: %w", err)
		}
		if n > 0 {
			r.Existing++
			continue
		}
		if _, err := im.exec(`INSERT INTO comments (video_id, user_id, body, created_at) VALUES (?, ?, ?, ?)`,
			video, user, body, at); err != nil {
			return fmt.Errorf("import: comment: %w", err)
		}
		r.Added++
		if shortened {
			r.Shortened++
		}
	}
	return nil
}

// saved puts the old "Salvati" in "Guarda più tardi", where the new
// FranzPLAY keeps the videos to watch later.
func (im *importer) saved() error {
	r := &im.report.Saved
	for _, s := range im.old.saved {
		user, video, ok := im.pair(s.user, s.video)
		if !ok {
			r.Skipped++
			continue
		}
		now := im.now.Unix()
		if _, err := im.exec(`INSERT INTO playlists (user_id, kind, name, created_at, updated_at)
			VALUES (?, 'later', '', ?, ?) ON CONFLICT DO NOTHING`, user, now, now); err != nil {
			return fmt.Errorf("import: watch later: %w", err)
		}
		var list int64
		if err := im.tx.QueryRowContext(im.ctx, `SELECT id FROM playlists WHERE user_id = ? AND kind = 'later'`, user).Scan(&list); err != nil {
			return fmt.Errorf("import: watch later: %w", err)
		}
		res, err := im.exec(`INSERT INTO playlist_items (playlist_id, video_id, position, added_at)
			SELECT ?, ?, coalesce(max(position), 0) + 1, ? FROM playlist_items WHERE playlist_id = ?
			ON CONFLICT DO NOTHING`, list, video, im.when(s.at), list)
		if err != nil {
			return fmt.Errorf("import: watch later: %w", err)
		}
		if ok, err := added(res); err != nil {
			return fmt.Errorf("import: watch later: %w", err)
		} else if ok {
			r.Added++
		} else {
			r.Existing++
		}
	}
	return nil
}

// history brings where each person stopped. Whether a video was finished
// is decided again with the new video's real length: the old FranzPLAY
// read its durations wrongly and marked long videos finished too early.
// A video the person took out of "Continua a guardare" stays out.
func (im *importer) history() error {
	r := &im.report.History
	for _, p := range im.old.progress {
		user, video, ok := im.pair(p.user, p.video)
		if !ok {
			r.Skipped++
			continue
		}
		var duration sql.NullInt64
		if err := im.tx.QueryRowContext(im.ctx, `SELECT duration FROM videos WHERE id = ?`, video).Scan(&duration); err != nil {
			return fmt.Errorf("import: history: %w", err)
		}
		m, err := progress.Decide(float64(p.position), duration.Int64)
		if err != nil {
			r.Skipped++
			continue
		}
		at := im.when(p.at)
		// A newer position, saved by the new FranzPLAY, wins.
		res, err := im.exec(`INSERT INTO watch_progress (user_id, video_id, position, finished, in_continue, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (user_id, video_id) DO UPDATE SET
				position = excluded.position, finished = excluded.finished,
				in_continue = excluded.in_continue, updated_at = excluded.updated_at
			WHERE excluded.updated_at > watch_progress.updated_at`,
			user, video, m.Position, m.Finished, p.inContinue, at)
		if err != nil {
			return fmt.Errorf("import: history: %w", err)
		}
		if ok, err := added(res); err != nil {
			return fmt.Errorf("import: history: %w", err)
		} else if ok {
			r.Added++
		} else {
			r.Existing++
		}
	}
	return nil
}

// loginsKept is how far back the access log goes: the same 90 days the
// new FranzPLAY keeps.
const loginsKept = 90 * 24 * time.Hour

func (im *importer) logins() error {
	r := &im.report.Logins
	names := map[string]int64{}
	for _, u := range im.old.users {
		if id, ok := im.userOf[u.id]; ok {
			names[strings.ToLower(u.name)] = id
		}
	}
	since := im.now.Add(-loginsKept)
	for _, l := range im.old.logins {
		if l.at.Before(since) {
			r.Old++
			continue
		}
		outcome := "wrong_password"
		if l.ok {
			outcome = "entered"
		}
		var user any // NULL when nobody has that name
		if id, ok := names[strings.ToLower(l.name)]; ok {
			user = id
		}
		var n int
		if err := im.tx.QueryRowContext(im.ctx, `SELECT count(*) FROM logins WHERE at = ? AND name = ? AND address = ? AND outcome = ?`,
			l.at.Unix(), l.name, l.address, outcome).Scan(&n); err != nil {
			return fmt.Errorf("import: access log: %w", err)
		}
		if n > 0 {
			r.Existing++
			continue
		}
		if _, err := im.exec(`INSERT INTO logins (at, name, user_id, address, outcome) VALUES (?, ?, ?, ?, ?)`,
			l.at.Unix(), l.name, user, l.address, outcome); err != nil {
			return fmt.Errorf("import: access log: %w", err)
		}
		r.Added++
	}
	return nil
}

// The look of the old site as it came out of the box.
var oldDefaultLook = site.Look{NameFirst: "FRANZ", NameSecond: "PLAY", Color: "#dc2626"}

// look brings the name and color of the old site, when the administrator
// had changed them there and has not chosen new ones here yet.
func (im *importer) look() error {
	s := im.old.settings
	old := site.Look{NameFirst: s["logo_part_1"], NameSecond: s["logo_part_2"], Color: s["colore_tema_default"]}
	if old.NameFirst == "" {
		old.NameFirst = oldDefaultLook.NameFirst
	}
	if old.NameSecond == "" {
		old.NameSecond = oldDefaultLook.NameSecond
	}
	if old.Color == "" {
		old.Color = oldDefaultLook.Color
	}
	clean, err := old.Clean()
	if err != nil {
		im.report.Look = LookUnreadable
		return nil //nolint:nilerr // a look the new site cannot show is reported, not a failure
	}
	if clean == oldDefaultLook {
		im.report.Look = LookDefault
		return nil
	}
	var n int
	if err := im.tx.QueryRowContext(im.ctx, `SELECT count(*) FROM settings WHERE key IN ('site.name_first', 'site.name_second', 'site.color')`).Scan(&n); err != nil {
		return fmt.Errorf("import: site look: %w", err)
	}
	if n > 0 {
		im.report.Look = LookKept
		return nil
	}
	for key, value := range map[string]string{"site.name_first": clean.NameFirst, "site.name_second": clean.NameSecond, "site.color": clean.Color} {
		if _, err := im.exec(`INSERT INTO settings (key, value) VALUES (?, ?)`, key, value); err != nil {
			return fmt.Errorf("import: site look: %w", err)
		}
	}
	im.report.Look = LookAdded
	return nil
}

// leftOut counts what the old FranzPLAY had and the new one cannot hold
// yet, so that nothing is lost without anybody knowing.
func (im *importer) leftOut() error {
	r := &im.report.LeftOut
	for _, v := range im.old.videos {
		if v.title != "" && v.title != fileTitle(v.path) {
			r.Titles++
		}
		if v.manual {
			r.Covers++
		}
	}
	for _, c := range im.old.categories {
		if c.name != c.path {
			r.Categories++
		}
	}
	if im.photosDir == "" {
		for _, u := range im.old.users {
			if u.photo != "" {
				r.Photos++
			}
		}
	}
	r.Subtitles = im.old.subtitles
	return nil
}

// fileTitle is the title the old FranzPLAY gave a video by itself: the
// file name without its extension.
func fileTitle(path string) string {
	parts := split(path)
	if len(parts) == 0 {
		return ""
	}
	name := parts[len(parts)-1]
	if i := strings.LastIndexByte(name, '.'); i > 0 {
		name = name[:i]
	}
	return name
}
