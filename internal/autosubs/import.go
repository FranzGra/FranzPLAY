package autosubs

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/FranzGra/FranzPLAY/internal/content"
	"github.com/FranzGra/FranzPLAY/internal/respond"
	"github.com/FranzGra/FranzPLAY/internal/video"
)

// ImportedModel is the model of subtitles the administrator brought from a
// file: they are kept as if whisper wrote them (same folder, same file,
// same row), so the player, the translations and the rest see them the
// same way. No whisper model has this name.
const ImportedModel = "import"

// maxImport is the largest subtitle file accepted: a long film's .srt is
// a few hundred kilobytes.
const maxImport = 2 << 20

// Why an imported file is refused, in words for the administrator.
var (
	errImportTooBig   = fmt.Errorf("Il file è troppo grande: al massimo %d MB.", maxImport>>20)
	errImportNotText  = errors.New("Il file non è un testo: scegli un file di sottotitoli .srt o .vtt.")
	errImportFormat   = errors.New("Formato non riconosciuto: si possono importare solo sottotitoli .srt o .vtt.")
	errImportNoCues   = errors.New("Il file non contiene nessuna battuta con i suoi tempi: controlla che sia un .srt o un .vtt valido.")
	errImportExisting = errors.New("Ci sono già sottotitoli in questa lingua: conferma per sostituirli.")
)

// importedVTT turns the bytes of an .srt or .vtt file into the WebVTT that
// is saved, written again cue by cue (only times and text stay: no markup
// but italics, bold and underline). What is not a subtitle file is refused.
func importedVTT(data []byte) (string, error) {
	utf16 := len(data) >= 2 && (data[0] == 0xFF && data[1] == 0xFE || data[0] == 0xFE && data[1] == 0xFF)
	if !utf16 && bytes.IndexByte(data, 0) >= 0 {
		return "", errImportNotText
	}
	text := video.DecodeSubtitleText(data)
	if strings.ContainsFunc(text, func(r rune) bool {
		return r < 0x20 && r != '\n' && r != '\r' && r != '\t' && r != '\f' || r == 0x7F
	}) {
		return "", errImportNotText
	}
	trimmed := strings.TrimLeft(strings.TrimPrefix(text, string(rune(0xFEFF))), " \t\r\n") // the byte order mark
	var vtt string
	switch {
	case strings.HasPrefix(trimmed, "WEBVTT"):
		vtt = video.ToWebVTT(trimmed, "vtt")
	case strings.Contains(trimmed, "-->"):
		vtt = video.ToWebVTT(trimmed, "srt")
	default:
		return "", errImportFormat
	}
	cues, err := video.ParseWebVTT(vtt)
	if err != nil || len(cues) == 0 {
		return "", errImportNoCues
	}
	return video.WebVTT(cues), nil
}

// handleImport saves a subtitle file the administrator chose as the
// subtitles of a video in one language:
//
//	PUT /api/admin/subtitles/{id}/import/{lang}[?replace=1]   body: the .srt or .vtt file
//
// The server chooses where the file goes and its name, the same as for
// whisper's subtitles. Subtitles already there in that language are
// replaced only with replace=1; otherwise the answer is 409.
func (p page) handleImport(w http.ResponseWriter, r *http.Request) {
	id, ok := parseID(r.PathValue("id"))
	if !ok {
		respond.Error(w, r, p.logger, http.StatusNotFound, "video not found")
		return
	}
	lang := r.PathValue("lang")
	if !validLang(lang) {
		respond.Error(w, r, p.logger, http.StatusBadRequest, "Lingua non valida.")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxImport))
	var tooBig *http.MaxBytesError
	switch {
	case errors.As(err, &tooBig):
		respond.Error(w, r, p.logger, http.StatusRequestEntityTooLarge, errImportTooBig.Error())
		return
	case err != nil:
		respond.Error(w, r, p.logger, http.StatusBadRequest, "Il file non è arrivato per intero: riprova.")
		return
	}
	vtt, err := importedVTT(data)
	if err != nil {
		respond.Error(w, r, p.logger, http.StatusUnsupportedMediaType, err.Error())
		return
	}
	switch err := p.saveImported(r.Context(), id, lang, vtt, r.URL.Query().Get("replace") == "1"); {
	case errors.Is(err, errNotFound):
		respond.Error(w, r, p.logger, http.StatusNotFound, "video not found")
	case errors.Is(err, errImportExisting):
		respond.Error(w, r, p.logger, http.StatusConflict, err.Error())
	case err != nil:
		respond.InternalError(w, r, p.logger, err)
	default:
		who, _ := p.account(r.Context())
		p.logger.InfoContext(r.Context(), "subtitles imported", "video", id, "lang", lang, "bytes", len(data), "by", who.Name)
		if p.queued != nil {
			p.queued()
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// saveImported writes the subtitles where whisper's go, and records them
// as whisper's are: the row is saved only with its file there.
func (p page) saveImported(ctx context.Context, id int64, lang, vtt string, replace bool) (err error) {
	var fingerprint string
	var exists bool
	err = p.db.QueryRowContext(ctx, `SELECT v.fingerprint,
		EXISTS (SELECT 1 FROM auto_subtitles a WHERE a.video_id = v.id AND a.lang = ?)
		FROM videos v WHERE v.id = ?`, lang, id).Scan(&fingerprint, &exists)
	if errors.Is(err, sql.ErrNoRows) {
		return errNotFound
	}
	if err != nil {
		return fmt.Errorf("import subtitles of video %d: %w", id, err)
	}
	if exists && !replace {
		return errImportExisting
	}
	root := p.opts.Content
	code, err := content.EnsureVideoFolder(ctx, p.db, root, id, fingerprint)
	if err != nil {
		return err
	}
	file := content.AutoSubtitleFile(lang)
	name := content.Stored(code, file, "")

	tx, err := p.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("import subtitles of video %d: %w", id, err)
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, tx.Rollback())
		}
	}()
	var old string
	err = tx.QueryRowContext(ctx, `DELETE FROM auto_subtitles WHERE video_id = ? AND lang = ? RETURNING file`, id, lang).Scan(&old)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		// None, or taken away meanwhile: nothing to replace.
	case err != nil:
		return fmt.Errorf("import subtitles of video %d: %w", id, err)
	case !replace:
		return errImportExisting // made meanwhile
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO auto_subtitles
		(video_id, lang, translated_from, model, fingerprint, file, made_at) VALUES (?, ?, '', ?, ?, ?, ?)`,
		id, lang, ImportedModel, fingerprint, name, p.now().Unix()); err != nil {
		return fmt.Errorf("import subtitles of video %d: %w", id, err)
	}
	if err := root.PutBytes(code, file, []byte(vtt)); err != nil {
		return fmt.Errorf("import subtitles of video %d: %w", id, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("import subtitles of video %d: %w", id, err)
	}
	return errors.Join(root.RemoveNotKept(old, name, root.AutoSubtitles()),
		content.SaveManifest(ctx, p.db, root, id))
}
