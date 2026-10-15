import { useEffect, useState } from "react";
import { fetchUpdates, saveUpdateCheck, type Updates } from "../../api/updates";
import { EmptyState } from "../../components/EmptyState";
import styles from "./Admin.module.css";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; updates: Updates };

// formatWhen writes a date and time the Italian way.
export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", { dateStyle: "medium", timeStyle: "short" });
}

// installedText says which FranzPLAY is running: the release, or the commit
// of a development build.
export function installedText(u: Updates): string {
  if (u.development) return `versione di sviluppo (${u.commit || "sconosciuta"})`;
  return u.release;
}

// UpdateSettings shows the installed version and whether FranzPLAY checks
// for new ones once a day.
export function UpdateSettings() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchUpdates(controller.signal)
      .then((updates) => setState({ kind: "ready", updates }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, []);

  if (state.kind === "loading") return <div className={styles.placeholder} aria-busy="true" />;
  if (state.kind === "error") {
    return (
      <EmptyState title="Versione non disponibile">
        Il server non ha risposto. Ricarica la pagina tra poco.
      </EmptyState>
    );
  }

  const change = (enabled: boolean) => {
    setBusy(true);
    setProblem("");
    saveUpdateCheck(enabled)
      .then((updates) => setState({ kind: "ready", updates }))
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non si è riusciti a salvare. Riprova tra poco.");
      })
      .finally(() => setBusy(false));
  };

  const u = state.updates;
  return (
    <>
      <h2 className={styles.groupTitle}>Aggiornamenti</h2>
      <ul className={`stagger ${styles.list}`} aria-label="Aggiornamenti">
        <li className={`glass ${styles.person}`}>
          <div>
            <p className={styles.name}>Controlla automaticamente le nuove versioni (ogni 24 ore)</p>
            <p className={styles.role}>
              Una volta al giorno FranzPLAY chiede a GitHub qual è l'ultima versione ufficiale. A
              GitHub arriva solo la richiesta, nessun dato dei tuoi video o delle persone. FranzPLAY
              non si aggiorna da solo: ti avvisa e ti dice come fare. Se è spento, GitHub non viene
              mai contattato.
            </p>
          </div>
          <label className={styles.check}>
            <input
              type="checkbox"
              aria-label="Controlla automaticamente le nuove versioni"
              checked={u.enabled}
              disabled={busy}
              onChange={(e) => change(e.target.checked)}
            />
            Acceso
          </label>
        </li>
        <li className={`glass ${styles.person}`}>
          <div>
            <p className={styles.role}>
              Versione installata: <strong>{installedText(u)}</strong>
            </p>
            {u.enabled && (
              <>
                <p className={styles.role}>
                  Ultima versione ufficiale:{" "}
                  <strong>
                    {u.latest || (u.checkedAt ? "nessuna pubblicata" : "non ancora controllata")}
                  </strong>
                  {u.latest && u.url && (
                    <>
                      {" · "}
                      <a href={u.url} target="_blank" rel="noreferrer">
                        note di rilascio
                      </a>
                    </>
                  )}
                </p>
                <p className={styles.role}>
                  Ultimo controllo: {u.checkedAt ? formatWhen(u.checkedAt) : "non ancora fatto"}
                </p>
                {u.newer && (
                  <p className={styles.name} role="status">
                    È disponibile la versione {u.latest}.
                  </p>
                )}
                {u.development && u.latest && (
                  <p className={styles.role}>
                    Questa è una versione di sviluppo: non si può confrontare con le versioni
                    ufficiali, quindi FranzPLAY non propone aggiornamenti.
                  </p>
                )}
              </>
            )}
          </div>
        </li>
      </ul>
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
    </>
  );
}
