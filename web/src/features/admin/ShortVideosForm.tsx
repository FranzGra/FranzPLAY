import { type FormEvent, useState } from "react";
import { maxMinDuration, saveMinDuration } from "../../api/library";
import styles from "./Admin.module.css";

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
      className={`glass ${styles.rules}`}
      onSubmit={send}
      aria-label="Video troppo corti"
      noValidate
    >
      <h2 className={styles.name}>Video troppo corti</h2>
      <p className={styles.role}>
        Se nelle cartelle ci sono video brevissimi che non vuoi vedere, come vecchie anteprime,
        FranzPLAY può lasciarli fuori. Restano nella cartella e non vengono mai cancellati: se
        spegni l'opzione, tornano tutti. I video caricati dal browser si vedono sempre.
      </p>

      <label className={styles.check}>
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Escludi i video più corti di
      </label>
      {on && (
        <label className={`${styles.field} ${styles.seconds}`}>
          Secondi
          <input
            type="number"
            min={1}
            max={maxMinDuration}
            step={1}
            value={seconds}
            onChange={(e) => setSeconds(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          />
        </label>
      )}

      {minDuration > 0 && (
        <p role="status" className={styles.done}>
          {tooShort === 0
            ? `Nessun video dura meno di ${minDuration} secondi.`
            : `${tooShort.toLocaleString("it-IT")} ${tooShort === 1 ? "video non si vede perché dura" : "video non si vedono perché durano"} meno di ${minDuration} secondi. Li trovi in Video › Troppo corti.`}
        </p>
      )}

      <div className={styles.buttons}>
        <button type="submit" className={styles.primary} disabled={sending || unchanged}>
          Salva
        </button>
      </div>
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
    </form>
  );
}
