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
	"github.com/FranzGra/FranzPLAY/internal/safefile"
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

// Translator translates the text of subtitles, keeping the times. It says
// ErrRefused when trying again cannot help. It knows nothing of the queue:
// any engine that does this can be plugged in.
type Translator interface {
	Cues(ctx context.Context, cues []video.Cue, from, to string) ([]video.Cue, error)
}

// Preparer is a translator with something to get ready before translating,
// like a model to download. It runs inside the job, which can be stopped.
type Preparer interface {
	Prepare(ctx context.Context, from, to string) error
}

// Batcher is a translator that says how many sentences it wants at a time.
type Batcher interface {
	BatchSize() int
}

// Stage is what a transcription is doing, for the administrator's page.
type Stage string

// The stages, in order. StageNone is a request waiting or finished.
const (
	StageNone       Stage = ""
	StageAudio      Stage = "audio"      // ffmpeg takes the sound out of the video
	StageTranscribe Stage = "transcribe" // whisper listens
	StageTranslate  Stage = "translate"  // the translator works, in a job of its own
)

// Transcriber writes subtitles from the sound of a video with whisper.cpp,
// as the administrator asked in the video's subtitle_requests row, and has
// subtitles translated, as asked in its translation_requests row: two jobs.
// The video file is only read (rule 1).
type Transcriber struct {
	db         *sql.DB
	ffmpeg     string // programs to run
	whisper    string
	dataDir    string
	translator Translator // nil: no translations
	threads    int        // how many processor cores whisper may use
	run        runFunc
	stream     streamFunc // runs whisper, reading how far it is as it goes
	now        func() time.Time
	changed    func()
}

// NewTranscriber returns a transcriber that runs the given ffmpeg and
// whisper programs and writes in dataDir/autosubtitles. translator may be
// nil. whisper leaves one processor core free, for the site: the job
// gives way to any other, so it only runs when nothing else needs doing.
func NewTranscriber(db *sql.DB, ffmpeg, whisper, dataDir string, translator Translator) *Transcriber {
	return &Transcriber{db: db, ffmpeg: ffmpeg, whisper: whisper, dataDir: dataDir, translator: translator,
		threads: max(1, runtime.NumCPU()-1), run: runInBackground, stream: streamInBackground, now: time.Now,
		changed: func() {}}
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
	madeAt                            time.Time
}

// ErrRefused means the translator will not translate, whatever we try
// again: a wrong key, or a language it does not have. A translator wraps it
// in its error, and the job does not try again.
var ErrRefused = errors.New("translation refused")

// errNoTranslator means a translation was asked but no translator is set.
var errNoTranslator = errors.New("the translator is off")

// errTakenBack means the administrator took the request back while the
// job ran: what was made is thrown away, and the job is not a failure.
var errTakenBack = errors.New("request taken back")

// errVideoChanged means the file changed while it was being transcribed.
var errVideoChanged = errors.New("the video file changed meanwhile: ask again")

// Handle is the job handler for jobs.Transcribe. What is already made for
// the current content is kept: asking for one more language only asks to
// translate that one. The translations are another job, queued at the end.
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

	heard, redone, err := t.transcript(ctx, videoID, file, fingerprint, req, made)
	if err != nil {
		return err
	}
	return t.queueTranslations(ctx, videoID, heard, req, made, redone)
}

// transcript makes whisper's subtitles of the current content, unless they
// are already there as asked, and says their language. redone reports that
// they were made now: the translations of the old ones are gone.
func (t *Transcriber) transcript(ctx context.Context, videoID int64, file, fingerprint string,
	req subtitleRequest, made map[string]autoSubtitle,
) (heard string, redone bool, err error) {
	for _, s := range made {
		if s.translatedFrom != "" || s.model != req.model || req.spoken != "" && s.lang != req.spoken {
			continue
		}
		return s.lang, false, nil
	}

	modelFile := ModelFile(t.dataDir, req.model)
	if _, err := os.Stat(modelFile); err != nil {
		return "", false, fmt.Errorf("whisper model %q: %w: %w", req.model, err, jobs.ErrPermanent)
	}
	heard, cues, err := t.listen(ctx, videoID, file, modelFile, req.spoken)
	if err != nil {
		return "", false, err
	}
	if err := t.saveTranscript(ctx, videoID, fingerprint, req.model, heard, cues); err != nil {
		return "", false, err
	}
	return heard, true, nil
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
	heardSoFar := whisperProgress{total: wavSeconds(sound), percent: -1}
	jobs.Report(ctx, heardSoFar.progress())
	err = t.stream(ctx, t.whisper, func(line string) {
		if heardSoFar.read(line) {
			jobs.Report(ctx, heardSoFar.progress())
		}
	}, whisperArgs(modelFile, sound, spoken, t.threads, out)...)
	if err != nil {
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
	rows, err := t.db.QueryContext(ctx, `SELECT lang, translated_from, model, file, made_at FROM auto_subtitles
		WHERE video_id = ? AND fingerprint = ?`, videoID, fingerprint)
	if err != nil {
		return nil, fmt.Errorf("subtitles of video %d: %w", videoID, err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	made := map[string]autoSubtitle{}
	for rows.Next() {
		var s autoSubtitle
		var at int64
		if err := rows.Scan(&s.lang, &s.translatedFrom, &s.model, &s.file, &at); err != nil {
			return nil, fmt.Errorf("subtitles of video %d: %w", videoID, err)
		}
		s.madeAt = time.Unix(at, 0)
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

// saveTranslation saves one translation of some subtitles.
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
// is gone: whisper's or, for a translation, its own.
func (t *Transcriber) record(ctx context.Context, videoID int64, fingerprint, model, lang, from, name string,
	replaceAll bool,
) (old []string, saved bool, err error) {
	tx, err := t.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, false, fmt.Errorf("save subtitles of video %d: %w", videoID, err)
	}
	defer func() { err = finish(tx, err) }()

	requests := "translation_requests"
	if replaceAll {
		requests = "subtitle_requests"
	}
	var same, asked bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM videos WHERE id = ? AND fingerprint = ?),
		EXISTS (SELECT 1 FROM `+requests+` WHERE video_id = ?)`,
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
	jobs.Report(ctx, jobs.Progress{Stage: string(stage), Percent: -1})
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
// -np keeps whisper's long report on the machine out; what it heard still
// comes out, one line a sentence, and -pp adds how far it is, every 5%
// (see whisperProgress).
func whisperArgs(model, sound, spoken string, threads int, out string) []string {
	lang := spoken
	if lang == "" {
		lang = "auto"
	}
	return []string{"-m", model, "-f", sound, "-l", lang, "-t", strconv.Itoa(threads),
		"-oj", "-of", out, "-np", "-pp"}
}

// whisperProgress follows how far whisper is from what it prints, as
// whisper.cpp 1.9 prints it:
//
//	whisper_print_progress_callback: progress =  38%
//	[00:01:01.280 --> 00:01:08.480]   Domani pioverà al nord.
//
// The first comes every 5% of the work, but whisper counts in pieces of
// 30 seconds, so on a short video it jumps; the second, the end of the
// last sentence heard, moves with every sentence. The progress is the
// further of the two.
type whisperProgress struct {
	total   float64 // seconds of sound; 0 = not known
	heard   float64 // seconds heard so far
	percent float64 // what whisper said, -1 = nothing yet
}

// read reads one line of whisper's and reports whether it moved on.
func (w *whisperProgress) read(line string) bool {
	if _, after, ok := strings.Cut(line, "progress ="); ok {
		n, err := strconv.Atoi(strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(after), "%")))
		if err != nil || n < 0 || n > 100 || float64(n) <= w.percent {
			return false
		}
		w.percent = float64(n)
		return true
	}
	start := strings.Index(line, "[")
	arrow := strings.Index(line, "-->")
	end := strings.Index(line, "]")
	if start < 0 || arrow < start || end < arrow {
		return false
	}
	seconds, ok := clockSeconds(strings.TrimSpace(line[arrow+3 : end]))
	if !ok || seconds <= w.heard {
		return false
	}
	w.heard = seconds
	if w.total > 0 {
		w.heard = min(w.heard, w.total)
	}
	return true
}

// progress is how far whisper is, for the queue's page.
func (w *whisperProgress) progress() jobs.Progress {
	p := jobs.Progress{Stage: string(StageTranscribe), Percent: w.percent, Done: w.heard, Total: w.total}
	if w.total > 0 {
		p.Percent = max(p.Percent, w.heard*100/w.total)
	}
	return p
}

// clockSeconds reads "01:02:03.500", as whisper writes times, in seconds.
func clockSeconds(s string) (float64, bool) {
	parts := strings.Split(s, ":")
	if len(parts) != 3 {
		return 0, false
	}
	h, errH := strconv.Atoi(parts[0])
	m, errM := strconv.Atoi(parts[1])
	sec, errS := strconv.ParseFloat(parts[2], 64)
	if errH != nil || errM != nil || errS != nil || h < 0 || m < 0 || m > 59 || sec < 0 || sec >= 60 {
		return 0, false
	}
	return float64(h*3600+m*60) + sec, true
}

// wavSeconds is how long the sound soundArgs wrote lasts: 16000 samples
// of 2 bytes a second, after a header of 44 bytes. 0 if it cannot tell.
func wavSeconds(name string) float64 {
	info, err := os.Stat(name)
	if err != nil || info.Size() <= 44 {
		return 0
	}
	return float64(info.Size()-44) / (16000 * 2)
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
	return safefile.Rename(tmp.Name(), filepath.Join(dir, name))
}

// RemoveOrphanAutoSubtitles deletes the files in the autosubtitles folder
// that no subtitle uses any more, and work left half done. Like the
// others, it must run before the job worker starts.
func RemoveOrphanAutoSubtitles(ctx context.Context, db *sql.DB, dataDir string) (removed int, err error) {
	return removeOrphans(ctx, db, filepath.Join(dataDir, AutoSubtitlesDir), "auto_subtitles", "file")
}
