package media

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/translate"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// AutoSubtitlesDir is the folder, inside the data folder, that holds the
// subtitles written by whisper and their translations.
const AutoSubtitlesDir = "autosubtitles"

// WhisperDir is the folder, inside the data folder, where the
// administrator puts whisper's models: ggml-small.bin, ggml-medium.bin…
const WhisperDir = "whisper"

// ModelFile is where the model with this name is: "small" is
// whisper/ggml-small.bin. The name must come from Models or be checked
// with video.WhisperModel first.
func ModelFile(dataDir, name string) string {
	return filepath.Join(dataDir, WhisperDir, "ggml-"+name+".bin")
}

// Models lists the names of the models in the whisper folder, in order.
// No folder means no models.
func Models(dataDir string) ([]string, error) {
	entries, err := os.ReadDir(filepath.Join(dataDir, WhisperDir))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read whisper models: %w", err)
	}
	var names []string
	for _, e := range entries {
		if name, ok := video.WhisperModel(e.Name()); ok && e.Type().IsRegular() {
			names = append(names, name)
		}
	}
	return names, nil
}

// Translator translates the text of subtitles; *translate.Client is one.
type Translator interface {
	Cues(ctx context.Context, cues []video.Cue, from, to string) ([]video.Cue, error)
}

// Stage is what a transcription is doing, for the administrator's page.
type Stage string

// The stages, in order. StageNone is a request waiting or finished.
const (
	StageNone       Stage = ""
	StageAudio      Stage = "audio"      // ffmpeg takes the sound out of the video
	StageTranscribe Stage = "transcribe" // whisper listens
	StageTranslate  Stage = "translate"  // the translator works
)

// Transcriber writes subtitles from the sound of a video with whisper.cpp,
// then has them translated, as the administrator asked in the video's
// subtitle_requests row. The video file is only read (rule 1).
type Transcriber struct {
	db         *sql.DB
	ffmpeg     string // programs to run
	whisper    string
	dataDir    string
	translator Translator // nil: no translations
	threads    int        // how many processor cores whisper may use
	run        runFunc
	now        func() time.Time
	changed    func()
}

// NewTranscriber returns a transcriber that runs the given ffmpeg and
// whisper programs and writes in dataDir/autosubtitles. translator may be
// nil. whisper leaves one processor core free, for the site: the job
// gives way to any other, so it only runs when nothing else needs doing.
func NewTranscriber(db *sql.DB, ffmpeg, whisper, dataDir string, translator Translator) *Transcriber {
	return &Transcriber{db: db, ffmpeg: ffmpeg, whisper: whisper, dataDir: dataDir, translator: translator,
		threads: max(1, runtime.NumCPU()-1), run: runInBackground, now: time.Now, changed: func() {}}
}

// OnStage sets a function called when a transcription moves to another
// stage, so the administrator's page can follow it.
func (t *Transcriber) OnStage(f func()) {
	t.changed = f
}

// subtitleRequest is what the administrator asked for a video.
type subtitleRequest struct {
	spoken string   // "" = whisper guesses
	model  string   // "small"
	langs  []string // the subtitles wanted
}

// autoSubtitle is a subtitle already made for a video.
type autoSubtitle struct {
	lang, translatedFrom, model, file string
}

// errNoTranslator means a translation was asked but no translator is set.
var errNoTranslator = errors.New("no translator set (FRANZPLAY_TRANSLATE_URL)")

// errTakenBack means the administrator took the request back while the
// job ran: what was made is thrown away, and the job is not a failure.
var errTakenBack = errors.New("request taken back")

// errVideoChanged means the file changed while it was being transcribed.
var errVideoChanged = errors.New("the video file changed meanwhile: ask again")

// Handle is the job handler for jobs.Transcribe. What is already made for
// the current content is kept: asking for one more language only
// translates that one.
func (t *Transcriber) Handle(ctx context.Context, videoID int64) error {
	err := t.handle(ctx, videoID)
	if errors.Is(err, errTakenBack) {
		return nil
	}
	return err
}

func (t *Transcriber) handle(ctx context.Context, videoID int64) (err error) {
	req, ok, err := t.request(ctx, videoID)
	if err != nil || !ok {
		return err // no request: the administrator took it back
	}
	defer func() { err = errors.Join(err, t.setStage(context.WithoutCancel(ctx), videoID, StageNone)) }()
	file, fingerprint, err := locate(ctx, t.db, videoID)
	if err != nil {
		return err
	}
	made, err := t.made(ctx, videoID, fingerprint)
	if err != nil {
		return err
	}

	heard, cues, redone, err := t.transcript(ctx, videoID, file, fingerprint, req, made)
	if err != nil {
		return err
	}
	for _, lang := range req.langs {
		if lang == heard {
			continue // whisper's own subtitles
		}
		if s, ok := made[lang]; ok && !redone && s.translatedFrom == heard {
			continue
		}
		if err := t.translateTo(ctx, videoID, fingerprint, req.model, heard, lang, cues); err != nil {
			return err
		}
	}
	return nil
}

// transcript returns whisper's subtitles of the current content, making
// them unless they are already there as asked. redone reports that they
// were made now: the translations of the old ones are gone.
func (t *Transcriber) transcript(ctx context.Context, videoID int64, file, fingerprint string,
	req subtitleRequest, made map[string]autoSubtitle,
) (heard string, cues []video.Cue, redone bool, err error) {
	for _, s := range made {
		if s.translatedFrom != "" || s.model != req.model || req.spoken != "" && s.lang != req.spoken {
			continue
		}
		data, err := readSmall(filepath.Join(t.dataDir, AutoSubtitlesDir, s.file))
		if err != nil {
			return "", nil, false, fmt.Errorf("subtitles of video %d: %w", videoID, err)
		}
		cues, err := video.ParseWebVTT(string(data))
		if err != nil {
			return "", nil, false, fmt.Errorf("subtitles of video %d: %w", videoID, err)
		}
		return s.lang, cues, false, nil
	}

	modelFile := ModelFile(t.dataDir, req.model)
	if _, err := os.Stat(modelFile); err != nil {
		return "", nil, false, fmt.Errorf("whisper model %q: %w: %w", req.model, err, jobs.ErrPermanent)
	}
	heard, cues, err = t.listen(ctx, videoID, file, modelFile, req.spoken)
	if err != nil {
		return "", nil, false, err
	}
	if err := t.saveTranscript(ctx, videoID, fingerprint, req.model, heard, cues); err != nil {
		return "", nil, false, err
	}
	return heard, cues, true, nil
}

// listen takes the sound out of the video with ffmpeg and has whisper
// write down what is said.
func (t *Transcriber) listen(ctx context.Context, videoID int64, file, modelFile, spoken string,
) (heard string, cues []video.Cue, err error) {
	stream, err := t.soundStream(ctx, videoID, spoken)
	if err != nil {
		return "", nil, err
	}
	dir := filepath.Join(t.dataDir, AutoSubtitlesDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", nil, fmt.Errorf("create subtitles folder: %w", err)
	}
	// The sound of a film is a few hundred megabytes: it lives in a
	// temporary folder, deleted when whisper has finished.
	work, err := os.MkdirTemp(dir, ".new-*")
	if err != nil {
		return "", nil, fmt.Errorf("subtitles of video %d: %w", videoID, err)
	}
	defer func() {
		if rmErr := os.RemoveAll(work); rmErr != nil {
			err = errors.Join(err, rmErr)
		}
	}()

	if err := t.setStage(ctx, videoID, StageAudio); err != nil {
		return "", nil, err
	}
	sound := filepath.Join(work, "sound.wav")
	if _, err := t.run(ctx, t.ffmpeg, soundArgs(file, stream, sound)...); err != nil {
		return "", nil, fmt.Errorf("sound of video %d: %w", videoID, err)
	}
	if err := t.setStage(ctx, videoID, StageTranscribe); err != nil {
		return "", nil, err
	}
	out := filepath.Join(work, "heard")
	if _, err := t.run(ctx, t.whisper, whisperArgs(modelFile, sound, spoken, t.threads, out)...); err != nil {
		return "", nil, fmt.Errorf("whisper on video %d: %w", videoID, err)
	}
	data, err := readSmall(out + ".json")
	if err != nil {
		return "", nil, fmt.Errorf("whisper on video %d: %w", videoID, err)
	}
	heard, cues, err = video.ParseWhisperJSON(data)
	if err != nil {
		return "", nil, fmt.Errorf("whisper on video %d: %w", videoID, err)
	}
	if len(cues) == 0 {
		return "", nil, fmt.Errorf("whisper on video %d: nobody speaks: %w", videoID, jobs.ErrPermanent)
	}
	return heard, cues, nil
}

// soundStream picks the sound track whisper listens to: the one in the
// spoken language, if the file says, otherwise the main one. -1 means
// the file lists no track: ffmpeg takes the first.
func (t *Transcriber) soundStream(ctx context.Context, videoID int64, spoken string) (stream int, err error) {
	var codec sql.NullString
	if err := t.db.QueryRowContext(ctx, `SELECT audio_codec FROM videos WHERE id = ?`, videoID).Scan(&codec); err != nil {
		return 0, fmt.Errorf("read video %d: %w", videoID, err)
	}
	if codec.Valid && codec.String == "" {
		return 0, fmt.Errorf("video %d has no sound: %w", videoID, jobs.ErrPermanent)
	}
	rows, err := t.db.QueryContext(ctx, `SELECT stream, lang FROM video_audio WHERE video_id = ?
		ORDER BY is_default DESC, stream`, videoID)
	if err != nil {
		return 0, fmt.Errorf("sound tracks of video %d: %w", videoID, err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	stream = -1
	for rows.Next() {
		var s int
		var lang string
		if err := rows.Scan(&s, &lang); err != nil {
			return 0, fmt.Errorf("sound tracks of video %d: %w", videoID, err)
		}
		if stream < 0 {
			stream = s // the main track, if no other is right
		}
		if spoken != "" && video.LangCode(lang) == spoken {
			return s, nil
		}
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("sound tracks of video %d: %w", videoID, err)
	}
	return stream, nil
}

// translateTo translates whisper's subtitles to one language and saves them.
func (t *Transcriber) translateTo(ctx context.Context, videoID int64, fingerprint, model, from, to string,
	cues []video.Cue,
) error {
	if t.translator == nil {
		return fmt.Errorf("subtitles of video %d in %s: %w: %w", videoID, to, errNoTranslator, jobs.ErrPermanent)
	}
	if err := t.setStage(ctx, videoID, StageTranslate); err != nil {
		return err
	}
	translated, err := t.translator.Cues(ctx, cues, from, to)
	if errors.Is(err, translate.ErrRefused) {
		return fmt.Errorf("subtitles of video %d: %w: %w", videoID, err, jobs.ErrPermanent)
	}
	if err != nil {
		return fmt.Errorf("subtitles of video %d: %w", videoID, err)
	}
	return t.saveTranslation(ctx, videoID, fingerprint, model, from, to, translated)
}

// request reads what the administrator asked for a video.
func (t *Transcriber) request(ctx context.Context, videoID int64) (subtitleRequest, bool, error) {
	var r subtitleRequest
	var langs string
	err := t.db.QueryRowContext(ctx, `SELECT spoken, model, langs FROM subtitle_requests WHERE video_id = ?`,
		videoID).Scan(&r.spoken, &r.model, &langs)
	if errors.Is(err, sql.ErrNoRows) {
		return subtitleRequest{}, false, nil
	}
	if err != nil {
		return subtitleRequest{}, false, fmt.Errorf("read subtitles asked for video %d: %w", videoID, err)
	}
	if _, ok := video.WhisperModel("ggml-" + r.model + ".bin"); !ok {
		return subtitleRequest{}, false, fmt.Errorf("video %d: model %q: %w", videoID, r.model, jobs.ErrPermanent)
	}
	if langs != "" {
		r.langs = strings.Split(langs, ",")
	}
	return r, true, nil
}

// made returns the subtitles already made from the video's current content.
func (t *Transcriber) made(ctx context.Context, videoID int64, fingerprint string) (_ map[string]autoSubtitle, err error) {
	rows, err := t.db.QueryContext(ctx, `SELECT lang, translated_from, model, file FROM auto_subtitles
		WHERE video_id = ? AND fingerprint = ?`, videoID, fingerprint)
	if err != nil {
		return nil, fmt.Errorf("subtitles of video %d: %w", videoID, err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	made := map[string]autoSubtitle{}
	for rows.Next() {
		var s autoSubtitle
		if err := rows.Scan(&s.lang, &s.translatedFrom, &s.model, &s.file); err != nil {
			return nil, fmt.Errorf("subtitles of video %d: %w", videoID, err)
		}
		made[s.lang] = s
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("subtitles of video %d: %w", videoID, err)
	}
	return made, nil
}

// saveTranscript saves whisper's subtitles. They replace all the
// subtitles made before for the video: the old translations came from
// other words.
func (t *Transcriber) saveTranscript(ctx context.Context, videoID int64, fingerprint, model, lang string,
	cues []video.Cue,
) error {
	return t.save(ctx, videoID, fingerprint, model, lang, "", cues, true)
}

// saveTranslation saves one translation of whisper's subtitles.
func (t *Transcriber) saveTranslation(ctx context.Context, videoID int64, fingerprint, model, from, lang string,
	cues []video.Cue,
) error {
	return t.save(ctx, videoID, fingerprint, model, lang, from, cues, false)
}

// save writes subtitles to their file, then records them. With replaceAll
// every other subtitle made for the video goes. Nothing is recorded if
// the content changed while whisper listened.
func (t *Transcriber) save(ctx context.Context, videoID int64, fingerprint, model, lang, from string,
	cues []video.Cue, replaceAll bool,
) (err error) {
	dir := filepath.Join(t.dataDir, AutoSubtitlesDir)
	name := autoSubtitleName(videoID, fingerprint, lang, t.now())
	if err := writeAtomic(dir, name, []byte(video.WebVTT(cues))); err != nil {
		return fmt.Errorf("subtitles of video %d: %w", videoID, err)
	}
	old, saved, err := t.record(ctx, videoID, fingerprint, model, lang, from, name, replaceAll)
	if errors.Is(err, errTakenBack) {
		return errors.Join(err, removeFile(dir, name))
	}
	if err != nil || !saved {
		err = errors.Join(err, removeFile(dir, name))
		if err == nil {
			err = fmt.Errorf("video %d: %w: %w", videoID, errVideoChanged, jobs.ErrPermanent)
		}
		return err
	}
	return removeAll(dir, slices.DeleteFunc(old, func(f string) bool { return f == name }))
}

// record saves one subtitle's row and returns the files of the rows it
// replaced. saved is false when the video's content is not fingerprint
// any more; nothing is saved either, with errTakenBack, when the request
// is gone.
func (t *Transcriber) record(ctx context.Context, videoID int64, fingerprint, model, lang, from, name string,
	replaceAll bool,
) (old []string, saved bool, err error) {
	tx, err := t.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, false, fmt.Errorf("save subtitles of video %d: %w", videoID, err)
	}
	defer func() { err = finish(tx, err) }()

	var same, asked bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM videos WHERE id = ? AND fingerprint = ?),
		EXISTS (SELECT 1 FROM subtitle_requests WHERE video_id = ?)`,
		videoID, fingerprint, videoID).Scan(&same, &asked); err != nil {
		return nil, false, fmt.Errorf("save subtitles of video %d: %w", videoID, err)
	}
	if !asked {
		return nil, false, errTakenBack
	}
	if !same {
		return nil, false, nil
	}
	where := `video_id = ? AND lang = ?`
	args := []any{videoID, lang}
	if replaceAll {
		where, args = `video_id = ?`, []any{videoID}
	}
	rows, err := tx.QueryContext(ctx, `SELECT file FROM auto_subtitles WHERE `+where, args...)
	if err != nil {
		return nil, false, fmt.Errorf("save subtitles of video %d: %w", videoID, err)
	}
	for rows.Next() {
		var f string
		if err := rows.Scan(&f); err != nil {
			return nil, false, errors.Join(fmt.Errorf("save subtitles of video %d: %w", videoID, err), rows.Close())
		}
		old = append(old, f)
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		return nil, false, fmt.Errorf("save subtitles of video %d: %w", videoID, err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM auto_subtitles WHERE `+where, args...); err != nil {
		return nil, false, fmt.Errorf("save subtitles of video %d: %w", videoID, err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO auto_subtitles
		(video_id, lang, translated_from, model, fingerprint, file, made_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		videoID, lang, from, model, fingerprint, name, t.now().Unix()); err != nil {
		return nil, false, fmt.Errorf("save subtitles of video %d: %w", videoID, err)
	}
	return old, true, nil
}

// setStage tells the administrator's page what the transcription does.
func (t *Transcriber) setStage(ctx context.Context, videoID int64, stage Stage) error {
	if _, err := t.db.ExecContext(ctx, `UPDATE subtitle_requests SET stage = ? WHERE video_id = ?`,
		string(stage), videoID); err != nil {
		return fmt.Errorf("subtitles of video %d: %w", videoID, err)
	}
	t.changed()
	return nil
}

// soundArgs builds the ffmpeg command that writes one sound track of the
// video as whisper wants it: mono, 16000 samples a second.
func soundArgs(file string, stream int, out string) []string {
	track := "0:a:0"
	if stream >= 0 {
		track = "0:" + strconv.Itoa(stream)
	}
	return []string{"-v", "error", "-y", "-i", "file:" + file, "-map", track, "-vn",
		"-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", "file:" + out}
}

// whisperArgs builds the whisper.cpp command that writes what is said in
// the sound as JSON to out.json. spoken "" lets whisper guess the language.
func whisperArgs(model, sound, spoken string, threads int, out string) []string {
	lang := spoken
	if lang == "" {
		lang = "auto"
	}
	return []string{"-m", model, "-f", sound, "-l", lang, "-t", strconv.Itoa(threads),
		"-oj", "-of", out, "-np"}
}

// autoSubtitleName is the file of a subtitle made for a video at a time.
// Like the covers, it changes when the video's content changes; the time
// keeps a new file from ever replacing one still in use.
func autoSubtitleName(videoID int64, fingerprint, lang string, at time.Time) string {
	return strings.TrimSuffix(coverName(videoID, fingerprint), ".jpg") + "-" + lang + "-" +
		strconv.FormatInt(at.UnixMilli(), 36) + ".vtt"
}

// maxTranscript is the biggest file of whisper's read back: the JSON of a
// two-hour film is about a megabyte.
const maxTranscript = 32 << 20

// readSmall reads a whole file made by FranzPLAY or whisper, refusing one
// that is far too big.
func readSmall(name string) (_ []byte, err error) {
	f, err := os.Open(name)
	if err != nil {
		return nil, err
	}
	defer func() { err = errors.Join(err, f.Close()) }()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if info.Size() > maxTranscript {
		return nil, fmt.Errorf("%s: too big (%d bytes)", filepath.Base(name), info.Size())
	}
	data := make([]byte, info.Size())
	if _, err := f.ReadAt(data, 0); err != nil && info.Size() > 0 {
		return nil, err
	}
	return data, nil
}

// writeAtomic writes a file of the data folder all at once (rule 6): a
// temporary file, renamed when complete.
func writeAtomic(dir, name string, data []byte) (err error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".new-*")
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, os.Remove(tmp.Name()))
		}
	}()
	if _, err := tmp.Write(data); err != nil {
		return errors.Join(err, tmp.Close())
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), filepath.Join(dir, name))
}

// RemoveOrphanAutoSubtitles deletes the files in the autosubtitles folder
// that no subtitle uses any more, and work left half done. Like the
// others, it must run before the job worker starts.
func RemoveOrphanAutoSubtitles(ctx context.Context, db *sql.DB, dataDir string) (removed int, err error) {
	return removeOrphans(ctx, db, filepath.Join(dataDir, AutoSubtitlesDir), "auto_subtitles", "file")
}
