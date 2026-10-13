import { type FormEvent, useState } from "react";
import { type OnlineRules, type OnlineStatus, type SourceName, saveRules } from "../../api/online";
import styles from "./Admin.module.css";

const names: Record<SourceName, string> = {
  youtube: "YouTube",
  tmdb: "TMDB (film)",
  tpdb: "ThePornDB",
};

const hours = Array.from({ length: 24 }, (_, h) => h);

function hourText(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

// OnlineRulesForm sets when FranzPLAY may ask the internet, how many
// videos a day, and which source it asks first.
export function OnlineRulesForm({
  status,
  onSaved,
}: {
  status: OnlineStatus;
  onSaved: (status: OnlineStatus) => void;
}) {
  const [rules, setRules] = useState<OnlineRules>(status.rules);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState("");
  const anyTime = rules.from === rules.to;

  const move = (index: number, by: number) => {
    const order = [...rules.order];
    const [source] = order.splice(index, 1);
    if (!source) return;
    order.splice(index + by, 0, source);
    setRules({ ...rules, order });
  };

  const send = (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setProblem("");
    saveRules(rules)
      .then(onSaved)
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non si è riusciti a salvare le regole. Riprova tra poco.");
      })
      .finally(() => setSending(false));
  };

  return (
    <form className={`glass ${styles.rules}`} onSubmit={send} aria-label="Regole">
      <h2 className={styles.name}>Regole</h2>
      <p className={styles.role}>
        Oggi FranzPLAY ha chiesto informazioni su {status.askedToday} video.
      </p>

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={!anyTime}
          onChange={(e) =>
            setRules({ ...rules, from: e.target.checked ? 2 : 0, to: e.target.checked ? 6 : 0 })
          }
        />
        Chiedi solo in certe ore
      </label>
      {!anyTime && (
        <div className={styles.momentControls}>
          <label className={styles.field}>
            Dalle
            <select
              className={`glass ${styles.select}`}
              value={rules.from}
              onChange={(e) => setRules({ ...rules, from: Number(e.target.value) })}
            >
              {hours.map((h) => (
                <option key={h} value={h}>
                  {hourText(h)}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Alle
            <select
              className={`glass ${styles.select}`}
              value={rules.to}
              onChange={(e) => setRules({ ...rules, to: Number(e.target.value) })}
            >
              {hours.map((h) => (
                <option key={h} value={h}>
                  {hourText(h)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <label className={styles.field}>
        Al massimo quanti video al giorno (0 = senza limite)
        <input
          type="number"
          min={0}
          max={100000}
          step={1}
          value={rules.daily}
          onChange={(e) =>
            setRules({
              ...rules,
              daily: Math.min(100000, Math.max(0, Math.floor(Number(e.target.value) || 0))),
            })
          }
        />
      </label>

      <div>
        <p className={styles.role}>
          Ordine delle fonti: FranzPLAY chiede prima alla prima che può riconoscere il video. Se non
          lo trova, prova la successiva.
        </p>
        <ol className={styles.order} aria-label="Ordine delle fonti">
          {rules.order.map((source, i) => (
            <li key={source}>
              <span>
                {i + 1}. {names[source]}
              </span>
              <span className={styles.buttons}>
                <button
                  type="button"
                  className={`glass ${styles.action}`}
                  aria-label={`Sposta ${names[source]} su`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={`glass ${styles.action}`}
                  aria-label={`Sposta ${names[source]} giù`}
                  disabled={i === rules.order.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
              </span>
            </li>
          ))}
        </ol>
      </div>

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={rules.confirm}
          onChange={(e) => setRules({ ...rules, confirm: e.target.checked })}
        />
        Chiedi conferma prima di usare quello che trova
      </label>
      <p className={styles.role}>
        Con la conferma, copertina e titolo trovati aspettano qui sotto finché scegli «Usa» o
        «Scarta». Le fonti rispondono solo quando riconoscono proprio quel video (stesso codice,
        stesso titolo e anno, o stessa impronta del file), quindi non c'è un punteggio da regolare.
      </p>

      <div className={styles.buttons}>
        <button type="submit" className={styles.primary} disabled={sending}>
          Salva le regole
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
