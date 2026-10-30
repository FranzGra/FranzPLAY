package media

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// Where the subtitles to translate come from: the values of
// translation_requests.source.
const (
	FromWhisper = "auto"   // written by whisper
	FromFile    = "file"   // a .srt or .vtt next to the video
	FromInside  = "inside" // copied from inside the video file
)

// translationRequest is what the administrator asked to translate.
type translationRequest struct {
	source, from string
	langs        []string
	redo         bool // make again the languages already translated
	at           time.Time
}

// translateBatch is how many sentences go to the translator at a time, to
// tell how far it is and to stop soon when the request is taken back, unless
// the translator says otherwise.
const translateBatch = 40

// errNoSource means the subtitles to translate are not there any more.
var errNoSource = errors.New("the subtitles to translate are not there any more: ask again")

// HandleTranslation is the job handler for jobs.Translate. It never runs
// whisper and never reads the sound: it starts from text already written.
// Each language is saved as soon as it is ready, so a job that stops and
// starts again goes on from the next one.
func (t *Transcriber) HandleTranslation(ctx context.Context, videoID int64) error {
	err := t.translation(ctx, videoID)
	if errors.Is(err, errTakenBack) {
		return nil
	}
	return err
}

func (t *Transcriber) translation(ctx context.Context, videoID int64) error {
	req, ok, err := t.translationRequest(ctx, videoID)
	if err != nil || !ok {
		return err // no request: the administrator took it back
	}
	if t.translator == nil {
		return fmt.Errorf("subtitles of video %d: %w: %w", videoID, errNoTranslator, jobs.ErrPermanent)
	}
	file, fingerprint, err := locate(ctx, t.db, videoID)
	if err != nil {
		return err
	}
	made, err := t.made(ctx, videoID, fingerprint)
	if err != nil {
		return err
	}
	var todo []string
	for _, lang := range req.langs {
		if s, ok := made[lang]; !ok || !req.skips(s) {
			todo = append(todo, lang)
		}
	}
	if len(todo) == 0 {
		return nil
	}
	cues, model, err := t.sourceCues(ctx, videoID, file, req, made)
	if err != nil {
		return err
	}
	total := len(cues) * len(todo)
	for i, lang := range todo {
		translated, err := t.translateCues(ctx, videoID, cues, req.from, lang, i*len(cues), total)
		if err != nil {
			return err
		}
		if err := t.saveTranslation(ctx, videoID, fingerprint, model, req.from, lang, translated); err != nil {
			return err
		}
	}
	return nil
}

// skips reports whether a subtitle already made in a language wanted stays
// as it is. Whisper's own are never overwritten by a translation. What was
// made since the request was made for it: it is only the job starting again.
func (r translationRequest) skips(s autoSubtitle) bool {
	switch {
	case s.translatedFrom == "":
		return true
	case s.translatedFrom != r.from:
		return false
	case r.redo:
		return !s.madeAt.Before(r.at)
	}
	return true
}

// translationRequest reads what the administrator asked to translate.
func (t *Transcriber) translationRequest(ctx context.Context, videoID int64) (translationRequest, bool, error) {
	var r translationRequest
	var langs string
	var at int64
	err := t.db.QueryRowContext(ctx, `SELECT source, from_lang, langs, redo, requested_at
		FROM translation_requests WHERE video_id = ?`, videoID).Scan(&r.source, &r.from, &langs, &r.redo, &at)
	if errors.Is(err, sql.ErrNoRows) {
		return translationRequest{}, false, nil
	}
	if err != nil {
		return translationRequest{}, false, fmt.Errorf("read translation asked for video %d: %w", videoID, err)
	}
	r.langs = strings.Split(langs, ",")
	r.at = time.Unix(at, 0)
	return r, true, nil
}

// sourceCues reads the subtitles to translate, and the whisper model that
// wrote them when it was whisper.
func (t *Transcriber) sourceCues(ctx context.Context, videoID int64, file string, req translationRequest,
	made map[string]autoSubtitle,
) (cues []video.Cue, model string, err error) {
	var text string
	switch req.source {
	case FromWhisper:
		s, ok := made[req.from]
		if !ok || s.translatedFrom != "" {
			return nil, "", fmt.Errorf("video %d: %w: %w", videoID, errNoSource, jobs.ErrPermanent)
		}
		model = s.model
		data, err := readSmall(filepath.Join(t.dataDir, AutoSubtitlesDir, s.file))
		if err != nil {
			return nil, "", fmt.Errorf("subtitles of video %d: %w", videoID, err)
		}
		text = string(data)
	case FromFile:
		text, err = fileSubtitle(file, req.from)
	case FromInside:
		text, err = t.insideSubtitle(ctx, videoID, req.from)
	default:
		err = fmt.Errorf("%w: unknown source %q", errNoSource, req.source)
	}
	if err != nil {
		return nil, "", fmt.Errorf("video %d: %w: %w", videoID, err, jobs.ErrPermanent)
	}
	parsed, err := video.ParseWebVTT(text)
	if err != nil {
		return nil, "", fmt.Errorf("subtitles of video %d: %w: %w", videoID, err, jobs.ErrPermanent)
	}
	cues = make([]video.Cue, 0, len(parsed))
	for _, c := range parsed {
		c.Text = strings.TrimSpace(keepStyle(c.Text))
		if c.Text != "" {
			cues = append(cues, c)
		}
	}
	if len(cues) == 0 {
		return nil, "", fmt.Errorf("video %d: %w: %w", videoID, errNoSource, jobs.ErrPermanent)
	}
	return cues, model, nil
}

// cueMarkup is the markup a subtitle not written by FranzPLAY may have.
var cueMarkup = regexp.MustCompile(`</?[a-zA-Z][^>]*>|\{\\[^}]*\}`)

// cueStyle is the markup that stays: italics, bold and underline, which a
// browser shows. The rest, like <font> or {\an8}, it would not understand.
var cueStyle = regexp.MustCompile(`(?i)^</?[biu]>$`)

func keepStyle(text string) string {
	return cueMarkup.ReplaceAllStringFunc(text, func(mark string) string {
		if cueStyle.MatchString(mark) {
			return strings.ToLower(mark)
		}
		return ""
	})
}

// fileSubtitle reads, as WebVTT, the subtitle in a language next to a video.
// The folder and the file are only read (rule 1). A subtitle for the forced
// parts only is used when there is no other.
func fileSubtitle(videoFile, lang string) (string, error) {
	entries, err := os.ReadDir(filepath.Dir(videoFile))
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return "", fmt.Errorf("read video folder: %w", err)
	}
	var names []string
	for _, e := range entries {
		if e.Type().IsRegular() {
			names = append(names, e.Name())
		}
	}
	subs := slices.DeleteFunc(video.FindSubtitles(videoFile, names), func(s video.Subtitle) bool {
		return video.MainLang(s.Lang) != lang
	})
	if len(subs) == 0 {
		return "", errNoSource
	}
	slices.SortStableFunc(subs, func(a, b video.Subtitle) int {
		return boolInt(strings.Contains(a.Key, "forced")) - boolInt(strings.Contains(b.Key, "forced"))
	})
	name := strings.TrimSuffix(videoFile, filepath.Ext(videoFile)) + "." + subs[0].Key
	data, err := readSmall(name)
	if err != nil {
		return "", fmt.Errorf("read subtitle file: %w", err)
	}
	return video.ToWebVTT(video.DecodeSubtitleText(data), subs[0].Format), nil
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// insideSubtitle reads the copy of a subtitle inside the video, in a
// language. A subtitle for the forced parts only is used when there is no
// other.
func (t *Transcriber) insideSubtitle(ctx context.Context, videoID int64, lang string) (_ string, err error) {
	rows, err := t.db.QueryContext(ctx, `SELECT lang, file FROM video_subtitles WHERE video_id = ?
		ORDER BY forced, stream`, videoID)
	if err != nil {
		return "", fmt.Errorf("read subtitles of video %d: %w", videoID, err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	for rows.Next() {
		var l, file string
		if err := rows.Scan(&l, &file); err != nil {
			return "", fmt.Errorf("read subtitles of video %d: %w", videoID, err)
		}
		if video.MainLang(l) != lang {
			continue
		}
		data, err := readSmall(filepath.Join(t.dataDir, SubtitlesDir, filepath.Base(file)))
		if err != nil {
			return "", fmt.Errorf("read subtitle copy: %w", err)
		}
		return string(data), nil
	}
	if err := rows.Err(); err != nil {
		return "", fmt.Errorf("read subtitles of video %d: %w", videoID, err)
	}
	return "", errNoSource
}

// translateCues translates to one language a few cues at a time, to tell
// how far it is, and stops as soon as the request is taken back. before is
// how many cues were translated for the languages before this one, and
// total how many there are for all the languages together.
func (t *Transcriber) translateCues(ctx context.Context, videoID int64, cues []video.Cue, from, to string,
	before, total int,
) ([]video.Cue, error) {
	if p, ok := t.translator.(Preparer); ok {
		err := p.Prepare(ctx, from, to)
		if errors.Is(err, ErrRefused) {
			return nil, fmt.Errorf("subtitles of video %d: %w: %w", videoID, err, jobs.ErrPermanent)
		}
		if err != nil {
			return nil, fmt.Errorf("subtitles of video %d: %w", videoID, err)
		}
	}
	size := translateBatch
	if b, ok := t.translator.(Batcher); ok {
		size = b.BatchSize()
	}
	out := make([]video.Cue, 0, len(cues))
	for start := 0; start < len(cues); start += size {
		t.reportTranslation(ctx, before+start, total)
		asked, err := t.asked(ctx, videoID, "translation_requests")
		if err != nil {
			return nil, err
		}
		if !asked {
			return nil, errTakenBack
		}
		batch, err := t.translator.Cues(ctx, cues[start:min(start+size, len(cues))], from, to)
		if errors.Is(err, ErrRefused) {
			return nil, fmt.Errorf("subtitles of video %d: %w: %w", videoID, err, jobs.ErrPermanent)
		}
		if err != nil {
			return nil, fmt.Errorf("subtitles of video %d: %w", videoID, err)
		}
		out = append(out, batch...)
	}
	t.reportTranslation(ctx, before+len(cues), total)
	return out, nil
}

// reportTranslation tells how far a translation is: Done and Total count
// the sentences, for all the languages asked.
func (t *Transcriber) reportTranslation(ctx context.Context, done, total int) {
	jobs.Report(ctx, jobs.Progress{Stage: string(StageTranslate), Percent: float64(done) * 100 / float64(total),
		Done: float64(done), Total: float64(total)})
}

// asked reports whether a request is still in its table: a name from this
// package, not from outside.
func (t *Transcriber) asked(ctx context.Context, videoID int64, table string) (bool, error) {
	var asked bool
	if err := t.db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM `+table+` WHERE video_id = ?)`,
		videoID).Scan(&asked); err != nil {
		return false, fmt.Errorf("subtitles of video %d: %w", videoID, err)
	}
	return asked, nil
}

// queueTranslations asks, after a transcription, for the translations that
// came with it: they are a job of their own, so the listening is safe
// whatever happens to the translator. The languages already translated
// from the same words stay as they are.
func (t *Transcriber) queueTranslations(ctx context.Context, videoID int64, heard string, req subtitleRequest,
	made map[string]autoSubtitle, redone bool,
) (err error) {
	wanted := make([]string, 0, len(req.langs))
	for _, lang := range req.langs {
		if lang == heard {
			continue // whisper's own subtitles
		}
		if s, ok := made[lang]; ok && !redone && s.translatedFrom == heard {
			continue
		}
		wanted = append(wanted, lang)
	}
	if len(wanted) == 0 {
		return nil
	}
	tx, err := t.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("ask translations of video %d: %w", videoID, err)
	}
	defer func() { err = finish(tx, err) }()
	now := t.now()
	if _, err := tx.ExecContext(ctx, `INSERT INTO translation_requests (video_id, source, from_lang, langs, redo, requested_at)
		SELECT video_id, ?, ?, ?, 0, ? FROM subtitle_requests WHERE video_id = ?
		ON CONFLICT (video_id) DO UPDATE SET source = excluded.source, from_lang = excluded.from_lang,
			langs = excluded.langs, redo = 0, requested_at = excluded.requested_at`,
		FromWhisper, heard, strings.Join(wanted, ","), now.Unix(), videoID); err != nil {
		return fmt.Errorf("ask translations of video %d: %w", videoID, err)
	}
	return jobs.Enqueue(ctx, tx, videoID, jobs.Translate, false, now)
}
