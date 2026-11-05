import { type FormEvent, useEffect, useId, useState } from "react";
import {
  type ClipSettings,
  fetchClipSettings,
  maxClipSeconds,
  maxClipStartPercent,
  minClipSeconds,
  saveClipSettings,
} from "../../api/clipSettings";
import { Icon } from "../../components/Icon";
import pages from "./Pages.module.css";
import { Card, Chip, Loading, Unavailable, ui } from "./ui";

// The point offered when the administrator leaves the automatic start.
const firstPercent = 10;

// ClipSettingsCard chooses, for the whole site, where the clips on the
// cards start and how long they last. The choice is used by the clips made
// from now on: the ones already made stay as they are, and a video's own
// choice, made on its page, wins over it.
export function ClipSettingsCard() {
  const [saved, setSaved] = useState<ClipSettings | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchClipSettings(controller.signal)
      .then(setSaved)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setFailed(true);
      });
    return () => controller.abort();
  }, []);

  return (
    <Card title="Anteprime dei video" icon="film" sub="I secondi che partono sulla scheda">
      {failed ? (
        <Unavailable title="Impostazioni non disponibili" />
      ) : saved ? (
        <ClipSettingsForm saved={saved} onSaved={setSaved} />
      ) : (
        <Loading />
      )}
    </Card>
  );
}

function ClipSettingsForm({
  saved,
  onSaved,
}: {
  saved: ClipSettings;
  onSaved: (s: ClipSettings) => void;
}) {
  const [fixed, setFixed] = useState(saved.startPercent > 0);
  const [percent, setPercent] = useState(saved.startPercent || firstPercent);
  const [seconds, setSeconds] = useState(saved.seconds);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState("");
  const percentId = useId();
  const secondsId = useId();

  const chosen: ClipSettings = { startPercent: fixed ? percent : 0, seconds };
  const unchanged = chosen.startPercent === saved.startPercent && chosen.seconds === saved.seconds;

  const send = (event: FormEvent) => {
    event.preventDefault();
    if (fixed && (percent < 1 || percent > maxClipStartPercent)) {
      setProblem(`Scegli un punto tra 1 e ${maxClipStartPercent} per cento.`);
      return;
    }
    if (seconds < minClipSeconds || seconds > maxClipSeconds) {
      setProblem(`Scegli una durata tra ${minClipSeconds} e ${maxClipSeconds} secondi.`);
      return;
    }
    setBusy(true);
    setProblem("");
    setDone("");
    saveClipSettings(chosen)
      .then((s) => {
        onSaved(s);
        setDone("Salvato. Vale per le anteprime fatte da adesso.");
      })
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non si è riusciti a salvare. Riprova tra poco.");
      })
      .finally(() => setBusy(false));
  };

  const change = (next: () => void) => {
    setDone("");
    next();
  };

  return (
    <form className={pages.editor} onSubmit={send} aria-label="Anteprime dei video" noValidate>
      <p className={ui.cardText}>
        Vale per le anteprime fatte da adesso: quelle già pronte restano come sono. Per rifarne una,
        o sceglierne il momento, vai sulla pagina del video.
      </p>
      <fieldset className={ui.segmented} disabled={busy}>
        <legend className="visually-hidden">Da dove parte l'anteprima</legend>
        {[
          { id: false, label: "Automatica" },
          { id: true, label: "Da un punto fisso" },
        ].map((c) => (
          <label key={c.label} className={ui.segment}>
            <input
              type="radio"
              name="clip-start"
              className="visually-hidden"
              checked={fixed === c.id}
              onChange={() => change(() => setFixed(c.id))}
            />
            {c.label}
          </label>
        ))}
      </fieldset>
      <p className={ui.hint}>
        {fixed
          ? "Un solo pezzo, dal punto scelto. Se il video finisce prima, l'anteprima parte un po' prima."
          : "Tre pezzi, presi a un quarto, a metà e a tre quarti del video: si vede un po' di tutto. Un video sotto i 30 secondi dà un pezzo solo."}
      </p>
      <div className={pages.clipFields}>
        {fixed && (
          <div>
            <span className={ui.field}>
              <label htmlFor={percentId} className={ui.label}>
                Punto di partenza (% della durata)
              </label>
              <input
                id={percentId}
                className={ui.input}
                type="number"
                inputMode="numeric"
                min={1}
                max={maxClipStartPercent}
                step={1}
                value={percent}
                disabled={busy}
                onChange={(e) =>
                  change(() => setPercent(Math.max(0, Math.floor(Number(e.target.value) || 0))))
                }
              />
            </span>
          </div>
        )}
        <div>
          <span className={ui.field}>
            <label htmlFor={secondsId} className={ui.label}>
              Durata (secondi)
            </label>
            <input
              id={secondsId}
              className={ui.input}
              type="number"
              inputMode="numeric"
              min={minClipSeconds}
              max={maxClipSeconds}
              step={1}
              value={seconds}
              disabled={busy}
              onChange={(e) =>
                change(() => setSeconds(Math.max(0, Math.floor(Number(e.target.value) || 0))))
              }
            />
          </span>
        </div>
      </div>
      <div className={pages.formFoot}>
        <span />
        <div className={ui.chips}>
          {unchanged ? (
            <Chip tone="ok" icon="check">
              Nessuna modifica da salvare
            </Chip>
          ) : (
            <>
              <button
                type="button"
                className={`${ui.btn} ${ui.ghost}`}
                disabled={busy}
                onClick={() => {
                  setFixed(saved.startPercent > 0);
                  setPercent(saved.startPercent || firstPercent);
                  setSeconds(saved.seconds);
                  setProblem("");
                }}
              >
                Annulla
              </button>
              <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={busy}>
                <Icon name="check" size={16} />
                {busy ? "Salvo…" : "Salva anteprime"}
              </button>
            </>
          )}
        </div>
      </div>
      {problem && (
        <p role="alert" className={ui.problem}>
          {problem}
        </p>
      )}
      {done && (
        <p role="status" className={ui.okText}>
          {done}
        </p>
      )}
    </form>
  );
}
