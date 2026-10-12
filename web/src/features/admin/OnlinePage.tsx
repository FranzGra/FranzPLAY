import { useEffect, useState } from "react";
import { fetchSources, type OnlineSources, saveSources } from "../../api/online";
import { EmptyState } from "../../components/EmptyState";
import styles from "./Admin.module.css";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; sources: OnlineSources };

// OnlinePage lets the administrator turn on the sources on the internet
// that give covers and details of the videos. FranzPLAY works the same
// with all of them off.
export function OnlinePage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchSources(controller.signal)
      .then((sources) => setState({ kind: "ready", sources }))
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
      <EmptyState title="Impostazioni non disponibili">
        Il server non ha risposto. Ricarica la pagina tra poco.
      </EmptyState>
    );
  }

  const change = (next: OnlineSources) => {
    setBusy(true);
    setProblem("");
    setDone("");
    saveSources(next)
      .then((sources) => {
        setState({ kind: "ready", sources });
        setDone(
          sources.youtube && !state.sources.youtube
            ? "Acceso. FranzPLAY chiede a YouTube un video alla volta: lo vedi in Lavori."
            : "Salvato.",
        );
      })
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non si è riusciti a salvare. Riprova tra poco.");
      })
      .finally(() => setBusy(false));
  };

  return (
    <>
      <div className={styles.top}>
        <p className={styles.lead}>
          FranzPLAY funziona anche senza internet. Se accendi una fonte, chiede copertine e
          informazioni dei video che riconosce. Manda solo il codice del video, niente su di te o su
          chi usa FranzPLAY. Quello che c'è nei file accanto ai video conta sempre di più.
        </p>
      </div>
      <ul className={styles.list} aria-label="Fonti su internet">
        <li className={`glass ${styles.person}`}>
          <div>
            <p className={styles.name}>YouTube</p>
            <p className={styles.role}>
              Per i video scaricati da YouTube, con il codice nel nome del file, come li salva
              yt-dlp: <code>Gita in montagna [dQw4w9WgXcQ].mp4</code>. Dà copertina, titolo e
              canale. Non serve nessuna chiave.
            </p>
          </div>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={state.sources.youtube}
              disabled={busy}
              onChange={(e) => change({ ...state.sources, youtube: e.target.checked })}
            />
            Accesa
          </label>
        </li>
      </ul>
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
      {done && (
        <p role="status" className={styles.done}>
          {done}
        </p>
      )}
    </>
  );
}
