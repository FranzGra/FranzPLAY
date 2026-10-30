package autosubs

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// Translation is what the administrator asked to translate, and how it goes.
type Translation struct {
	Source Source    `json:"source"` // the subtitles it starts from
	From   string    `json:"from"`   // their language
	To     []string  `json:"to"`     // the languages wanted
	Redo   bool      `json:"redo"`   // make again the ones already there
	State  string    `json:"state"`  // the job: "pending", "running", "failed"
	Error  string    `json:"error"`  // why it failed, or why it will try again
	At     time.Time `json:"at"`     // when it was asked
	// While the job runs: when it started, what it is doing ("translate", or
	// "model" while it downloads what it needs), how far it is from 0 to 100,
	// and the sentences translated so far and in all, for all the languages,
	// or the bytes of a download. null when not running, or not known (yet).
	Stage     string     `json:"stage"`
	StartedAt *time.Time `json:"startedAt"`
	Progress  *float64   `json:"progress"`
	Done      *float64   `json:"done"`
	Total     *float64   `json:"total"`
}

// translateBody is the body of PUT /api/admin/subtitles/{id}/translation.
type translateBody struct {
	Source Source   `json:"source"`
	From   string   `json:"from"`
	To     []string `json:"to"`
	Redo   bool     `json:"redo"`
}

// The reasons a translation cannot be asked now.
var (
	// errPresent means the video already has subtitles in a language wanted.
	errPresent = errors.New("the video already has subtitles in this language")
	// errNoSubtitles means the subtitles to start from are not there.
	errNoSubtitles = errors.New("the video has no such subtitles to translate")
	// errListening means whisper is at work on the video: what it writes
	// could replace the subtitles to translate.
	errListening = errors.New("whisper is working on this video: ask when it has finished")
	// errNoTranslator means there is no translator, or it does not answer.
	errNoTranslator = errors.New("the translator is off or does not answer")
)

// checkTranslate controls a request once, at the door (rule 8). It says
// errNoTranslator when the translator cannot say what it knows.
func (p page) checkTranslate(ctx context.Context, b translateBody) error {
	if b.Source != FromAuto && b.Source != FromFile && b.Source != FromInside {
		return fmt.Errorf("%w: unknown source %q", errBadRequest, b.Source)
	}
	if !validLang(b.From) {
		return fmt.Errorf("%w: bad language %q", errBadRequest, b.From)
	}
	if len(b.To) == 0 {
		return fmt.Errorf("%w: no language to translate to", errBadRequest)
	}
	for i, lang := range b.To {
		if !video.IsAutoLanguage(lang) || lang == b.From || slices.Contains(b.To[:i], lang) {
			return fmt.Errorf("%w: bad language %q", errBadRequest, lang)
		}
	}
	if p.opts.Translator == nil {
		return errNoTranslator
	}
	ctx, cancel := context.WithTimeout(ctx, translatorTimeout)
	defer cancel()
	known, err := p.opts.Translator.Languages(ctx)
	if err != nil {
		return fmt.Errorf("%w: %w", errNoTranslator, err)
	}
	for _, lang := range append([]string{b.From}, b.To...) {
		if !slices.Contains(known, lang) {
			return fmt.Errorf("%w: the translator does not know %q", errBadRequest, lang)
		}
	}
	return nil
}

func (p page) handleTranslate(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		respond.Error(w, r, p.logger, http.StatusNotFound, "video not found")
		return
	}
	var b translateBody
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&b); err != nil {
		respond.Error(w, r, p.logger, http.StatusBadRequest, `the body must be {"source": "auto", "from": "en", "to": ["it"], "redo": false}`)
		return
	}
	err := p.checkTranslate(r.Context(), b)
	if err == nil {
		err = p.askTranslation(r.Context(), id, b)
	}
	switch {
	case errors.Is(err, errBadRequest):
		respond.Error(w, r, p.logger, http.StatusBadRequest, err.Error())
	case errors.Is(err, errNotFound):
		respond.Error(w, r, p.logger, http.StatusNotFound, "video not found")
	case errors.Is(err, errNoTranslator):
		p.logger.WarnContext(r.Context(), "translation asked without a translator", "error", err)
		respond.Error(w, r, p.logger, http.StatusServiceUnavailable, errNoTranslator.Error())
	case errors.Is(err, errMissing), errors.Is(err, errPresent), errors.Is(err, errNoSubtitles), errors.Is(err, errListening):
		respond.Error(w, r, p.logger, http.StatusConflict, err.Error())
	case err != nil:
		respond.InternalError(w, r, p.logger, err)
	default:
		who, _ := p.account(r.Context())
		p.logger.InfoContext(r.Context(), "translation asked", "video", id, "source", b.Source, "from", b.From,
			"to", strings.Join(b.To, ","), "redo", b.Redo, "by", who.Name)
		p.queued()
		w.WriteHeader(http.StatusNoContent)
	}
}

// askTranslation saves a request and puts the job in the queue. Subtitles
// in a language wanted stay safe: only a translation can be made again, and
// only when asked; whisper's own and the ones not made here, never.
func (p page) askTranslation(ctx context.Context, id int64, b translateBody) (err error) {
	subs, err := p.subtitlesOf(ctx, id)
	if err != nil {
		return err
	}
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("ask translation of video %d: %w", id, err)
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, tx.Rollback())
			return
		}
		err = tx.Commit()
	}()
	var missing bool
	err = tx.QueryRowContext(ctx, `SELECT missing_since IS NOT NULL FROM videos WHERE id = ?`, id).Scan(&missing)
	if errors.Is(err, sql.ErrNoRows) {
		return errNotFound
	}
	if err != nil {
		return fmt.Errorf("ask translation of video %d: %w", id, err)
	}
	if missing {
		return errMissing
	}
	var listening bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM jobs WHERE video_id = ? AND kind = ?
		AND state IN ('pending', 'running'))`, id, string(jobs.Transcribe)).Scan(&listening); err != nil {
		return fmt.Errorf("ask translation of video %d: %w", id, err)
	}
	if listening {
		return errListening
	}
	if !slices.ContainsFunc(subs, func(s Subtitle) bool {
		return s.Source == b.Source && s.From == "" && video.MainLang(s.Lang) == b.From
	}) {
		return errNoSubtitles
	}
	for _, s := range subs {
		lang := video.MainLang(s.Lang)
		if !slices.Contains(b.To, lang) {
			continue
		}
		if !b.Redo || s.Source != FromAuto || s.From == "" {
			return fmt.Errorf("%w: %s", errPresent, lang)
		}
	}
	now := p.now()
	if _, err := tx.ExecContext(ctx, `INSERT INTO translation_requests (video_id, source, from_lang, langs, redo, requested_at)
		VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (video_id) DO UPDATE
		SET source = excluded.source, from_lang = excluded.from_lang, langs = excluded.langs,
		    redo = excluded.redo, requested_at = excluded.requested_at`,
		id, string(b.Source), b.From, strings.Join(b.To, ","), b.Redo, now.Unix()); err != nil {
		return fmt.Errorf("ask translation of video %d: %w", id, err)
	}
	return jobs.Enqueue(ctx, tx, id, jobs.Translate, false, now)
}

func (p page) handleTakeBackTranslation(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		respond.Error(w, r, p.logger, http.StatusNotFound, "request not found")
		return
	}
	err := p.takeBackTranslation(r.Context(), id)
	switch {
	case errors.Is(err, errNotFound):
		respond.Error(w, r, p.logger, http.StatusNotFound, "request not found")
	case err != nil:
		respond.InternalError(w, r, p.logger, err)
	default:
		p.queued()
		w.WriteHeader(http.StatusNoContent)
	}
}

// takeBackTranslation forgets a translation asked and its job. A translation
// running stops at its next few sentences; the languages already finished
// stay, and can be deleted one by one.
func (p page) takeBackTranslation(ctx context.Context, id int64) (err error) {
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("take back translation of video %d: %w", id, err)
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, tx.Rollback())
			return
		}
		err = tx.Commit()
	}()
	var there bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM translation_requests WHERE video_id = ?)`,
		id).Scan(&there); err != nil {
		return fmt.Errorf("take back translation of video %d: %w", id, err)
	}
	if !there {
		return errNotFound
	}
	if err := forgetTranslation(ctx, tx, id); err != nil {
		return fmt.Errorf("take back translation of video %d: %w", id, err)
	}
	return nil
}

// forgetTranslation deletes a translation request and its job, if any.
func forgetTranslation(ctx context.Context, tx *sql.Tx, id int64) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM translation_requests WHERE video_id = ?`, id); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `DELETE FROM jobs WHERE video_id = ? AND kind = ?`, id, string(jobs.Translate))
	return err
}

// subtitlesOf lists the subtitles one video has now, the ones next to the
// file included. The folder is only read (rule 1).
func (p page) subtitlesOf(ctx context.Context, id int64) (_ []Subtitle, err error) {
	var root, rel string
	err = p.db.QueryRowContext(ctx, `SELECT l.path, v.path FROM videos v JOIN libraries l ON l.id = v.library_id
		WHERE v.id = ?`, id).Scan(&root, &rel)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("subtitles of video %d: %w", id, err)
	}
	c := candidate{file: filepath.Join(root, filepath.FromSlash(rel))}
	rows, err := p.db.QueryContext(ctx, `SELECT lang, '', '', 0 FROM video_subtitles WHERE video_id = ?
		UNION ALL SELECT a.lang, a.translated_from, a.model, 1 FROM auto_subtitles a
		JOIN videos v ON v.id = a.video_id AND v.fingerprint = a.fingerprint WHERE a.video_id = ?`, id, id)
	if err != nil {
		return nil, fmt.Errorf("subtitles of video %d: %w", id, err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		var s Subtitle
		var auto bool
		if err := rows.Scan(&s.Lang, &s.From, &s.Model, &auto); err != nil {
			return nil, fmt.Errorf("subtitles of video %d: %w", id, err)
		}
		s.Source = FromInside
		if auto {
			s.Source = FromAuto
		}
		c.Subtitles = append(c.Subtitles, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("subtitles of video %d: %w", id, err)
	}
	if err := addFiles(&c, map[string][]string{}); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return c.Subtitles, nil
}

// translations returns the translations asked and not finished, by video,
// with the state of their job.
func (p page) translations(ctx context.Context) (_ map[int64]*Translation, err error) {
	rows, err := p.db.QueryContext(ctx, `SELECT r.video_id, r.source, r.from_lang, r.langs, r.redo, r.requested_at,
		j.state, j.last_error
		FROM translation_requests r JOIN jobs j ON j.video_id = r.video_id AND j.kind = ?
		WHERE j.state != 'done'`, string(jobs.Translate))
	if err != nil {
		return nil, fmt.Errorf("list translations: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := map[int64]*Translation{}
	for rows.Next() {
		var id, at int64
		var source, langs string
		var t Translation
		if err := rows.Scan(&id, &source, &t.From, &langs, &t.Redo, &at, &t.State, &t.Error); err != nil {
			return nil, fmt.Errorf("list translations: %w", err)
		}
		t.Source = Source(source)
		t.To = strings.Split(langs, ",")
		t.At = time.Unix(at, 0).UTC()
		if t.State == "running" {
			p.addTranslationProgress(id, &t)
		}
		out[id] = &t
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list translations: %w", err)
	}
	return out, nil
}

// addTranslationProgress adds how far the running translation of a video
// is, as the job worker knows it.
func (p page) addTranslationProgress(videoID int64, t *Translation) {
	if p.opts.Running == nil {
		return
	}
	for _, j := range p.opts.Running() {
		if j.Kind != jobs.Translate || j.VideoID != videoID {
			continue
		}
		t.StartedAt = new(j.StartedAt.UTC())
		if j.Known {
			t.Stage = j.Progress.Stage
			if j.Progress.Percent >= 0 {
				t.Progress = new(j.Progress.Percent)
			}
			if j.Progress.Total > 0 {
				t.Done, t.Total = new(j.Progress.Done), new(j.Progress.Total)
			}
		}
	}
}

// audioLangs returns the languages of the sound tracks the files name, by
// video, the main track first.
func (p page) audioLangs(ctx context.Context) (_ map[int64][]string, err error) {
	rows, err := p.db.QueryContext(ctx, `SELECT video_id, lang FROM video_audio ORDER BY video_id, is_default DESC, stream`)
	if err != nil {
		return nil, fmt.Errorf("list sound tracks: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	out := map[int64][]string{}
	for rows.Next() {
		var id int64
		var lang string
		if err := rows.Scan(&id, &lang); err != nil {
			return nil, fmt.Errorf("list sound tracks: %w", err)
		}
		if lang = video.MainLang(lang); validLang(lang) && lang != "und" && !slices.Contains(out[id], lang) {
			out[id] = append(out[id], lang)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list sound tracks: %w", err)
	}
	return out, nil
}
