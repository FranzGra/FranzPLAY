import { type FormEvent, useState } from "react";
import { maxMinDuration, saveMinDuration } from "../../api/library";
import { Icon } from "../../components/Icon";
import pages from "./Pages.module.css";
import { Chip, ui } from "./ui";

// The minimum offered when the administrator turns the option on.
const defaultSeconds = 10;

// ShortVideosForm leaves out the videos of the folders shorter than a
// number of seconds, such as old previews. They are only left out: the
// files stay where they are, and turning the option off brings them back.
export function ShortVideosForm({
  minDuration,
  tooShort,
  onSaved,
}: {
  minDuration: number;
  tooShort: number;
  onSaved: () => void;
}) {
  const [on, setOn] = useState(minDuration > 0);
  const [seconds, setSeconds] = useState(minDuration || defaultSeconds);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");

  const send = (event: FormEvent) => {
    event.preventDefault();
    if (on && (seconds < 1 || seconds > maxMinDuration)) {
      setProblem(`Scegli un numero di secondi tra 1 e ${maxMinDuration}.`);
      return;
    }
    setSending(true);
    setProblem("");
    saveMinDuration(on ? seconds : 0)
      .then(onSaved)
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non si è riusciti a salvare. Riprova tra poco.");
      })
      .finally(() => setSending(false));
  };

  const unchanged = on ? seconds === minDuration : minDuration === 0;
  return (
    <form
      className={`${ui.card} ${pages.editor}`}
      onSubmit={send}
      aria-label="Video troppo corti"
      noValidate
    >
      <h2 className={ui.cardTitle}>
        <span className={ui.cardIcon} aria-hidden="true">
          <Icon name="clock" size={18} />
        </span>
        Video troppo corti
      </h2>
      <p className={ui.cardText}>
        Se nelle cartelle ci sono video brevissimi che non vuoi vedere, come vecchie anteprime,
        FranzPLAY può lasciarli fuori. Restano nella cartella e non vengono mai cancellati: se
        spegni l'opzione, tornano tutti. I video caricati dal browser si vedono sempre.
      </p>

      <div className={pages.checks}>
        <label className={pages.check}>
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
          Escludi i video più corti di
        </label>
        {on && (
          <label className={pages.seconds}>
            <input
              className={ui.input}
              type="number"
              min={1}
              max={maxMinDuration}
              step={1}
              value={seconds}
              onChange={(e) => setSeconds(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            />
            Secondi
          </label>
        )}
      </div>

      {minDuration > 0 && (
        <p role="status" className={ui.okText}>
          {tooShort === 0
            ? `Nessun video dura meno di ${minDuration} secondi.`
            : `${tooShort.toLocaleString("it-IT")} ${tooShort === 1 ? "video non si vede perché dura" : "video non si vedono perché durano"} meno di ${minDuration} secondi. Li trovi in Video › Troppo corti.`}
        </p>
      )}

      <div className={pages.formFoot}>
        <span />
        {unchanged ? (
          <Chip tone="ok" icon="check">
            Nessuna modifica da salvare
          </Chip>
        ) : (
          <button type="submit" className={`${ui.btn} ${ui.primary}`} disabled={sending}>
            <Icon name="check" size={16} />
            Salva
          </button>
        )}
      </div>
      {problem && (
        <p role="alert" className={ui.problem}>
          {problem}
        </p>
      )}
    </form>
  );
}
