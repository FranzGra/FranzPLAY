package autosubs

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// Source says where a subtitle comes from.
type Source string

// The sources of subtitles.
const (
	FromFile   Source = "file"   // a .srt or .vtt next to the video
	FromInside Source = "inside" // inside the video file
	FromAuto   Source = "auto"   // written by whisper, or translated
)

// Subtitle is one subtitle of a video on the page.
type Subtitle struct {
	Lang   string `json:"lang"` // "it"; "" when the file does not say
	Source Source `json:"source"`
	From   string `json:"from"`  // for a translation, the language it was translated from
	Model  string `json:"model"` // for whisper's, the model that wrote them
}

// Request is what the administrator asked for a video, and how it goes.
type Request struct {
	Spoken    string    `json:"spoken"` // "" = whisper guesses
	Model     string    `json:"model"`
	Translate []string  `json:"translate"`
	Stage     string    `json:"stage"` // "", "audio", "transcribe", "translate"
	State     string    `json:"state"` // the job: "pending", "running", "done", "failed"
	Error     string    `json:"error"` // why it failed
	At        time.Time `json:"at"`    // when it was asked
	// While the job runs: when it started, and while whisper listens how
	// far it is, from 0 to 100, with the seconds of sound heard and in
	// all. null when not running, or not known (yet).
	StartedAt    *time.Time `json:"startedAt"`
	Progress     *float64   `json:"progress"`
	HeardSeconds *float64   `json:"heardSeconds"`
	TotalSeconds *float64   `json:"totalSeconds"`
}

// Item is one video on the page.
type Item struct {
	ID        int64      `json:"id"`
	Title     string     `json:"title"`
	Cover     *string    `json:"cover"`
	Subtitles []Subtitle `json:"subtitles"`
	Request   *Request   `json:"request"` // nil: nothing asked
	// Translation is the translation asked and not finished; nil: none.
	Translation *Translation `json:"translation"`
	// AudioLangs are the languages of the sound tracks, as the file says,
	// the main one first: a hint of the language spoken, not a certainty.
	AudioLangs []string `json:"audioLangs"`
}

// listQuery is what GET /api/admin/subtitles asks.
type listQuery struct {
	q      string // words in the title
	have   string // "", "with", "without": with any subtitles or with none
	lang   string // only the videos with subtitles in this language
	limit  int
	offset int
}

// maxLimit is the most videos on one page.
const maxLimit = 200

// parseListQuery checks the address once, at the door (rule 8).
func parseListQuery(v url.Values) (listQuery, error) {
	q := listQuery{q: strings.TrimSpace(v.Get("q")), have: v.Get("have"), lang: v.Get("lang"), limit: 50}
	if q.have != "" && q.have != "with" && q.have != "without" {
		return listQuery{}, errors.New(`have must be "with" or "without"`)
	}
	if q.lang != "" && !validLang(q.lang) {
		return listQuery{}, errors.New("lang must be a language code like it")
	}
	if s := v.Get("limit"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > maxLimit {
			return listQuery{}, fmt.Errorf("limit must be between 1 and %d", maxLimit)
		}
		q.limit = n
	}
	if s := v.Get("offset"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 0 {
			return listQuery{}, errors.New("offset must be 0 or more")
		}
		q.offset = n
	}
	return q, nil
}

// listAnswer is the body of GET /api/admin/subtitles.
type listAnswer struct {
	Videos []Item `json:"videos"`
	Total  int    `json:"total"`
}

func (p page) handleList(w http.ResponseWriter, r *http.Request) {
	q, err := parseListQuery(r.URL.Query())
	if err != nil {
		respond.Error(w, r, p.logger, http.StatusBadRequest, err.Error())
		return
	}
	items, total, err := p.list(r.Context(), q)
	if err != nil {
		respond.InternalError(w, r, p.logger, err)
		return
	}
	respond.JSON(w, r, p.logger, http.StatusOK, listAnswer{Videos: items, Total: total})
}

// candidate is a video on the page, with where its file is.
type candidate struct {
	Item
	file string
}

// list returns a page of the present videos: the ones with a request
// first, the newest request first, then all the others by title.
func (p page) list(ctx context.Context, q listQuery) ([]Item, int, error) {
	all, err := p.videos(ctx, q.q)
	if err != nil {
		return nil, 0, err
	}
	inside, auto, err := p.known(ctx)
	if err != nil {
		return nil, 0, err
	}
	requests, err := p.requests(ctx)
	if err != nil {
		return nil, 0, err
	}
	translations, err := p.translations(ctx)
	if err != nil {
		return nil, 0, err
	}
	audio, err := p.audioLangs(ctx)
	if err != nil {
		return nil, 0, err
	}
	for i := range all {
		all[i].Subtitles = append(slices.Clone(inside[all[i].ID]), auto[all[i].ID]...)
		all[i].Request = requests[all[i].ID]
		all[i].Translation = translations[all[i].ID]
		all[i].AudioLangs = audio[all[i].ID]
		if all[i].AudioLangs == nil {
			all[i].AudioLangs = []string{}
		}
	}
	slices.SortStableFunc(all, func(a, b candidate) int {
		at, bt := a.askedAt(), b.askedAt()
		switch {
		case !at.IsZero() && !bt.IsZero():
			return bt.Compare(at)
		case !at.IsZero():
			return -1
		case !bt.IsZero():
			return 1
		}
		return 0
	})

	folders := map[string][]string{} // the names in each folder read, read once
	filtering := q.have != "" || q.lang != ""
	if filtering {
		// The filters need the subtitles next to every video.
		for i := range all {
			if err := addFiles(&all[i], folders); err != nil {
				return nil, 0, err
			}
		}
		all = slices.DeleteFunc(all, func(c candidate) bool { return !q.keeps(c.Subtitles) })
	}
	total := len(all)
	page := all[min(q.offset, total):min(q.offset+q.limit, total)]
	items := make([]Item, len(page))
	for i := range page {
		if !filtering {
			if err := addFiles(&page[i], folders); err != nil {
				return nil, 0, err
			}
		}
		items[i] = page[i].Item
	}
	return items, total, nil
}

// askedAt is when something was last asked for a video; zero: nothing.
func (c candidate) askedAt() time.Time {
	var at time.Time
	if c.Request != nil {
		at = c.Request.At
	}
	if c.Translation != nil && c.Translation.At.After(at) {
		at = c.Translation.At
	}
	return at
}

// keeps reports whether a video with these subtitles matches the filters.
func (q listQuery) keeps(subs []Subtitle) bool {
	switch {
	case q.have == "with" && len(subs) == 0, q.have == "without" && len(subs) > 0:
		return false
	case q.lang != "":
		return slices.ContainsFunc(subs, func(s Subtitle) bool { return s.Lang == q.lang })
	}
	return true
}

// addFiles puts first the subtitles next to the video's file. The folder
// is only read (rule 1), once for all its videos.
func addFiles(c *candidate, folders map[string][]string) error {
	dir := filepath.Dir(c.file)
	names, ok := folders[dir]
	if !ok {
		entries, err := os.ReadDir(dir)
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("read video folder: %w", err)
		}
		for _, e := range entries {
			if e.Type().IsRegular() {
				names = append(names, e.Name())
			}
		}
		folders[dir] = names
	}
	var files []Subtitle
	for _, s := range video.FindSubtitles(c.file, names) {
		files = append(files, Subtitle{Lang: video.LangCode(s.Lang), Source: FromFile})
	}
	c.Subtitles = append(files, c.Subtitles...)
	if c.Subtitles == nil {
		c.Subtitles = []Subtitle{}
	}
	return nil
}

// videos returns the videos whose file is there, by title, with words in
// their title if q is not empty.
func (p page) videos(ctx context.Context, q string) (_ []candidate, err error) {
	where, args := `v.missing_since IS NULL`, []any{}
	if q != "" {
		where += ` AND v.shown_title LIKE ? ESCAPE '\'`
		args = append(args, "%"+escapeLike(q)+"%")
	}
	rows, err := p.db.QueryContext(ctx, `SELECT v.id, v.shown_title, v.cover, l.path, v.path
		FROM videos v JOIN libraries l ON l.id = v.library_id
		WHERE `+where+` ORDER BY v.shown_title COLLATE NOCASE, v.id`, args...)
	if err != nil {
		return nil, fmt.Errorf("list videos: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	var out []candidate
	for rows.Next() {
		var c candidate
		var cover *string
		var root, rel string
		if err := rows.Scan(&c.ID, &c.Title, &cover, &root, &rel); err != nil {
			return nil, fmt.Errorf("list videos: %w", err)
		}
		if cover != nil {
			address := "/api/covers/" + *cover
			c.Cover = &address
		}
		c.file = filepath.Join(root, filepath.FromSlash(rel))
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list videos: %w", err)
	}
	return out, nil
}

// known returns the subtitles the database knows, by video: the ones
// inside the files, and the ones whisper made from the current content.
func (p page) known(ctx context.Context) (inside, auto map[int64][]Subtitle, err error) {
	inside, auto = map[int64][]Subtitle{}, map[int64][]Subtitle{}
	err = p.each(ctx, `SELECT video_id, lang, '', '' FROM video_subtitles ORDER BY video_id, stream`,
		func(id int64, lang, _, _ string) {
			inside[id] = append(inside[id], Subtitle{Lang: video.LangCode(lang), Source: FromInside})
		})
	if err != nil {
		return nil, nil, err
	}
	err = p.each(ctx, `SELECT a.video_id, a.lang, a.translated_from, a.model FROM auto_subtitles a
		JOIN videos v ON v.id = a.video_id AND v.fingerprint = a.fingerprint
		ORDER BY a.video_id, a.translated_from != '', a.lang`,
		func(id int64, lang, from, model string) {
			auto[id] = append(auto[id], Subtitle{Lang: lang, Source: FromAuto, From: from, Model: model})
		})
	return inside, auto, err
}

// each runs a query of four columns, an id and three texts.
func (p page) each(ctx context.Context, query string, f func(id int64, a, b, c string)) (err error) {
	rows, err := p.db.QueryContext(ctx, query)
	if err != nil {
		return fmt.Errorf("list subtitles: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		var id int64
		var a, b, c string
		if err := rows.Scan(&id, &a, &b, &c); err != nil {
			return fmt.Errorf("list subtitles: %w", err)
		}
		f(id, a, b, c)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("list subtitles: %w", err)
	}
	return nil
}

// requests returns the requests, by video, with the state of their job.
func (p page) requests(ctx context.Context) (_ map[int64]*Request, err error) {
	rows, err := p.db.QueryContext(ctx, `SELECT r.video_id, r.spoken, r.model, r.langs, r.stage, r.requested_at,
		COALESCE(j.state, ''), COALESCE(j.last_error, '')
		FROM subtitle_requests r LEFT JOIN jobs j ON j.video_id = r.video_id AND j.kind = ?`, string(jobs.Transcribe))
	if err != nil {
		return nil, fmt.Errorf("list subtitle requests: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := map[int64]*Request{}
	for rows.Next() {
		var id, at int64
		var langs string
		var r Request
		if err := rows.Scan(&id, &r.Spoken, &r.Model, &langs, &r.Stage, &at, &r.State, &r.Error); err != nil {
			return nil, fmt.Errorf("list subtitle requests: %w", err)
		}
		r.At = time.Unix(at, 0).UTC()
		if r.State == "running" {
			p.addProgress(id, &r)
		}
		r.Translate = []string{}
		if langs != "" {
			r.Translate = strings.Split(langs, ",")
		}
		out[id] = &r
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list subtitle requests: %w", err)
	}
	return out, nil
}

// addProgress adds how far the running transcription of a video is, as
// the job worker knows it.
func (p page) addProgress(videoID int64, r *Request) {
	if p.opts.Running == nil {
		return
	}
	for _, j := range p.opts.Running() {
		if j.Kind != jobs.Transcribe || j.VideoID != videoID {
			continue
		}
		r.StartedAt = new(j.StartedAt.UTC())
		if j.Known && j.Progress.Stage == string(media.StageTranscribe) {
			if j.Progress.Percent >= 0 {
				r.Progress = new(j.Progress.Percent)
			}
			if j.Progress.Total > 0 {
				r.HeardSeconds, r.TotalSeconds = new(j.Progress.Done), new(j.Progress.Total)
			}
		}
	}
}

// likeEscapes protects the characters LIKE reads as patterns.
var likeEscapes = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

func escapeLike(s string) string { return likeEscapes.Replace(s) }
