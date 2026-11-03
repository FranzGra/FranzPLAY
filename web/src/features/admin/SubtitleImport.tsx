import { type ChangeEvent, type FormEvent, useState } from "react";
import { importProblem, importSubtitles, knownLanguages, languageName } from "../../api/autosubs";
import { ApiError } from "../../api/client";
import { Icon } from "../../components/Icon";
import { Select } from "../../components/Select";
import subs from "./Subtitles.module.css";
import { ui } from "./ui";

// SubtitleImport saves a .srt or .vtt file chosen by the administrator as
// the subtitles of a video in one language. The server keeps them where
// whisper's go, so the player and the translations use them the same way.
// Subtitles already there in that language are replaced only after asking.
// The administrator's subtitles page and a video's page both show it.
export function SubtitleImport({
  videoId,
  title,
  lang: firstLang = "it",
  onDone,
  onCancel,
}: {
  videoId: number;
  title: string;
  lang?: string;
  onDone: (lang: string) => void;
  onCancel?: () => void;
}) {
  const [lang, setLang] = useState(knownLanguages.includes(firstLang) ? firstLang : "it");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [confirm, setConfirm] = useState(false);

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0] ?? null;
    event.target.value = ""; // the same file can be chosen again
    setConfirm(false);
    if (!chosen) return;
    const wrong = importProblem(chosen);
    setProblem(wrong);
    setFile(wrong ? null : chosen);
  };

  const send = (replace: boolean) => {
    if (!file) {
      setProblem("Scegli prima un file .srt o .vtt.");
      return;
    }
    setBusy(true);
    setProblem("");
    importSubtitles(videoId, lang, file, replace)
      .then(() => {
        setFile(null);
        setConfirm(false);
        onDone(lang);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 409) {
          setConfirm(true);
          return;
        }
        console.error(error);
        setProblem(
          error instanceof ApiError && [400, 413, 415].includes(error.status)
            ? error.message
            : "Non sono riuscito a importare il file. Riprova tra poco.",
        );
      })
      .finally(() => setBusy(false));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send(false);
  };

  const language = languageName(lang).toLowerCase();
  return (
    <form className={subs.ask} onSubmit={submit} aria-label={`Importa sottotitoli per ${title}`}>
      <p className={subs.askLead}>
        Scegli un file di sottotitoli <b>.srt</b> o <b>.vtt</b> (al massimo 2 MB) e la sua lingua.
        Il file accanto al video non cambia: FranzPLAY ne tiene una copia sua.
      </p>
      <span className={ui.field}>
        <span className={ui.label}>Lingua</span>
        <Select
          aria-label="Lingua dei sottotitoli"
          value={lang}
          disabled={busy}
          options={knownLanguages.map((l) => ({ value: l, label: languageName(l) }))}
          onChange={(v) => {
            setLang(v);
            setConfirm(false);
          }}
        />
      </span>
      <span className={ui.chips}>
        <label className={ui.btn} aria-disabled={busy || undefined}>
          <Icon name="file" size={16} />
          {file ? "Scegli un altro file" : "Scegli il file"}
          <input
            type="file"
            accept=".srt,.vtt,text/vtt,application/x-subrip"
            className={ui.fileInput}
            disabled={busy}
            onChange={pick}
          />
        </label>
        {file && <span className={subs.hint}>{file.name}</span>}
      </span>
      {confirm ? (
        <div className={subs.ask} role="alertdialog" aria-label="Sostituire i sottotitoli?">
          <p className={subs.askLead}>
            <b>Ci sono già sottotitoli in {language} per questo video.</b> Vuoi sostituirli con
            questo file? Quelli di prima si perdono.
          </p>
          <span className={ui.chips}>
            <button
              type="button"
              className={`${ui.btn} ${ui.dangerBtn}`}
              disabled={busy}
              onClick={() => send(true)}
            >
              {busy ? "Sostituisco…" : "Sostituisci"}
            </button>
            <button
              type="button"
              className={`${ui.btn} ${ui.ghost}`}
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Non sostituire
            </button>
          </span>
        </div>
      ) : (
        <span className={ui.chips}>
          <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={busy}>
            <Icon name="upload" size={16} />
            {busy ? "Importo…" : "Importa"}
          </button>
          {onCancel && (
            <button type="button" className={`${ui.btn} ${ui.ghost}`} onClick={onCancel}>
              Lascia stare
            </button>
          )}
        </span>
      )}
      {problem && (
        <p role="alert" className={ui.problem}>
          {problem}
        </p>
      )}
    </form>
  );
}
