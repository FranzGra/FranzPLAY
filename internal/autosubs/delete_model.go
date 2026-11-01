package autosubs

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"slices"
	"strings"

	"github.com/FranzGra/FranzPLAY/internal/jobs"
	"github.com/FranzGra/FranzPLAY/internal/media"
	"github.com/FranzGra/FranzPLAY/internal/respond"
)

// ModelFile is a model on this machine.
type ModelFile struct {
	Name string `json:"name"`
	Size int64  `json:"size"` // bytes: what deleting it frees
	// Busy says to people why it cannot be deleted now; "" when it can.
	Busy string `json:"busy"`
}

// modelBusy is a model that cannot be deleted now; the text says why, to
// people.
type modelBusy string

func (b modelBusy) Error() string { return string(b) }

// modelUse is how many jobs are using a model and how many wait to.
type modelUse struct{ running, waiting int }

// querier is a database or a transaction.
type querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// whisperUse counts the transcriptions going on and waiting, by model. A job
// waiting would fail without its model, so it holds the model as much as one
// going on.
func whisperUse(ctx context.Context, q querier) (_ map[string]modelUse, err error) {
	rows, err := q.QueryContext(ctx, `SELECT r.model, j.state FROM jobs j
		JOIN subtitle_requests r ON r.video_id = j.video_id
		WHERE j.kind = ? AND j.state IN ('pending', 'running')`, string(jobs.Transcribe))
	if err != nil {
		return nil, fmt.Errorf("whisper models in use: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	use := map[string]modelUse{}
	for rows.Next() {
		var model, state string
		if err := rows.Scan(&model, &state); err != nil {
			return nil, fmt.Errorf("whisper models in use: %w", err)
		}
		use[model] = use[model].plus(state)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("whisper models in use: %w", err)
	}
	return use, nil
}

// translatorUse counts the translations going on and waiting, by model: one
// translation may take several.
func translatorUse(ctx context.Context, q querier, models TranslatorModels) (_ map[string]modelUse, err error) {
	rows, err := q.QueryContext(ctx, `SELECT r.from_lang, r.langs, j.state FROM jobs j
		JOIN translation_requests r ON r.video_id = j.video_id
		WHERE j.kind = ? AND j.state IN ('pending', 'running')`, string(jobs.Translate))
	if err != nil {
		return nil, fmt.Errorf("translation models in use: %w", err)
	}
	defer func() { err = errors.Join(err, rows.Close()) }()
	use := map[string]modelUse{}
	for rows.Next() {
		var from, langs, state string
		if err := rows.Scan(&from, &langs, &state); err != nil {
			return nil, fmt.Errorf("translation models in use: %w", err)
		}
		var needed []string
		for lang := range strings.SplitSeq(langs, ",") {
			needed = append(needed, models.Route(from, lang)...)
		}
		slices.Sort(needed)
		for _, name := range slices.Compact(needed) {
			use[name] = use[name].plus(state)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("translation models in use: %w", err)
	}
	return use, nil
}

func (u modelUse) plus(state string) modelUse {
	if state == "running" {
		u.running++
	} else {
		u.waiting++
	}
	return u
}

// whisperBusy says why a whisper model cannot be deleted now; "" when it can.
func (p page) whisperBusy(name string, u modelUse) string {
	switch {
	case u.running > 0 || p.opts.ModelInUse != nil && p.opts.ModelInUse(name):
		return "Non si può eliminare adesso: Whisper lo sta usando. Aspetta che finisca, oppure annulla il lavoro, e riprova."
	case p.opts.Downloader != nil && p.opts.Downloader.Downloading(name):
		return "Non si può eliminare adesso: se ne sta scaricando una copia. Aspetta che finisca, oppure annulla il download."
	case u.waiting == 1:
		return "Non si può eliminare adesso: 1 video in coda aspetta questo modello. Togli la trascrizione dalla coda, oppure aspetta che finisca, e riprova."
	case u.waiting > 1:
		return fmt.Sprintf("Non si può eliminare adesso: %d video in coda aspettano questo modello. "+
			"Togli le trascrizioni dalla coda, oppure aspetta che finiscano, e riprova.", u.waiting)
	}
	return ""
}

// translatorBusy says why a translation model cannot be deleted now; "" when
// it can.
func translatorBusy(u modelUse) string {
	switch {
	case u.running > 0:
		return "Non si può eliminare adesso: una traduzione lo sta usando. Aspetta che finisca, oppure annullala, e riprova."
	case u.waiting == 1:
		return "Non si può eliminare adesso: 1 traduzione in coda aspetta questo modello. Toglila dalla coda, oppure aspetta che finisca, e riprova."
	case u.waiting > 1:
		return fmt.Sprintf("Non si può eliminare adesso: %d traduzioni in coda aspettano questo modello. "+
			"Toglile dalla coda, oppure aspetta che finiscano, e riprova.", u.waiting)
	}
	return ""
}

// whisperFiles describes the models in the whisper folder.
func (p page) whisperFiles(ctx context.Context, models []string) ([]ModelFile, error) {
	use, err := whisperUse(ctx, p.db)
	if err != nil {
		return nil, err
	}
	files := make([]ModelFile, 0, len(models))
	for _, name := range models {
		info, err := os.Stat(media.ModelFile(p.opts.DataDir, name))
		if errors.Is(err, fs.ErrNotExist) {
			continue // deleted just now
		}
		if err != nil {
			return nil, fmt.Errorf("whisper model %s: %w", name, err)
		}
		files = append(files, ModelFile{Name: name, Size: info.Size(), Busy: p.whisperBusy(name, use[name])})
	}
	return files, nil
}

// translatorInfo is what the translator says of its models, with which of
// them cannot be deleted now.
func (p page) translatorInfo(ctx context.Context) (*ModelInfo, error) {
	info := p.opts.TranslatorModels.ModelInfo()
	use, err := translatorUse(ctx, p.db, p.opts.TranslatorModels)
	if err != nil {
		return nil, err
	}
	for i := range info.Files {
		info.Files[i].Busy = translatorBusy(use[info.Files[i].Name])
	}
	return &info, nil
}

// holdingQueue runs f with the write lock of the database: no job can start
// and none can be asked for while f looks at the queue and then deletes.
func (p page) holdingQueue(ctx context.Context, f func(tx *sql.Tx) error) (err error) {
	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("hold the job queue: %w", err)
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, tx.Rollback())
			return
		}
		err = tx.Commit()
	}()
	return f(tx)
}

// deleteWhisperModel deletes the file of a model and nothing else. The name
// must be one read from the whisper folder just now: only regular files with
// a model's name are there, so a name cannot lead anywhere else (rule 8). The
// subtitles already written with it stay.
func (p page) deleteWhisperModel(ctx context.Context, name string) error {
	models, err := media.Models(p.opts.DataDir)
	if err != nil {
		return err
	}
	if !slices.Contains(models, name) {
		return errUnknownModel
	}
	err = p.holdingQueue(ctx, func(tx *sql.Tx) error {
		use, err := whisperUse(ctx, tx)
		if err != nil {
			return err
		}
		if busy := p.whisperBusy(name, use[name]); busy != "" {
			return modelBusy(busy)
		}
		if err := os.Remove(media.ModelFile(p.opts.DataDir, name)); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("delete whisper model %s: %w", name, err)
		}
		return nil
	})
	if err == nil && p.opts.Downloader != nil {
		p.opts.Downloader.Forget(name)
	}
	return err
}

// deleteTranslatorModel deletes a translation model the translator has. The
// next translation that needs it downloads it again.
func (p page) deleteTranslatorModel(ctx context.Context, name string) error {
	models := p.opts.TranslatorModels
	if !slices.Contains(models.ModelInfo().Have, name) {
		return errUnknownModel
	}
	return p.holdingQueue(ctx, func(tx *sql.Tx) error {
		use, err := translatorUse(ctx, tx, models)
		if err != nil {
			return err
		}
		if busy := translatorBusy(use[name]); busy != "" {
			return modelBusy(busy)
		}
		return models.DeleteModel(name)
	})
}

func (p page) handleDeleteWhisperModel(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	p.answerDeleted(w, r, "whisper", name, p.deleteWhisperModel(r.Context(), name))
}

func (p page) handleDeleteTranslatorModel(w http.ResponseWriter, r *http.Request) {
	if p.opts.TranslatorModels == nil {
		respond.Error(w, r, p.logger, http.StatusNotFound, errUnknownModel.Error())
		return
	}
	name := r.PathValue("name")
	p.answerDeleted(w, r, "translator", name, p.deleteTranslatorModel(r.Context(), name))
}

// answerDeleted answers a request to delete a model. A refusal is in words for
// people: the page shows it as it is.
func (p page) answerDeleted(w http.ResponseWriter, r *http.Request, kind, name string, err error) {
	var busy modelBusy
	switch {
	case errors.Is(err, errUnknownModel):
		respond.Error(w, r, p.logger, http.StatusNotFound, err.Error())
	case errors.As(err, &busy):
		respond.Error(w, r, p.logger, http.StatusConflict, string(busy))
	case err != nil:
		respond.InternalError(w, r, p.logger, err)
	default:
		who, _ := p.account(r.Context())
		p.logger.InfoContext(r.Context(), "model deleted", "kind", kind, "model", name, "by", who.Name)
		p.queued() // the open pages hear of it
		w.WriteHeader(http.StatusNoContent)
	}
}
