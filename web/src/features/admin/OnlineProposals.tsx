import { useEffect, useState } from "react";
import {
  acceptProposal,
  discardProposal,
  fetchProposals,
  type Proposal,
  proposalPictureURL,
  type SourceName,
} from "../../api/online";
import styles from "./Admin.module.css";

const names: Record<SourceName, string> = {
  youtube: "YouTube",
  tmdb: "TMDB",
  tpdb: "ThePornDB",
};

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; list: Proposal[] };

// OnlineProposals lists what the sources found while the administrator
// asked to confirm: each one is used or thrown away by hand.
export function OnlineProposals({ onChange }: { onChange: (left: number) => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(0);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetchProposals(controller.signal)
      .then((list) => setState({ kind: "ready", list }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, []);

  const decide = (p: Proposal, use: boolean) => {
    if (state.kind !== "ready") return;
    setBusy(p.videoId);
    setProblem("");
    (use ? acceptProposal(p.videoId) : discardProposal(p.videoId))
      .then(() => {
        const list = state.list.filter((other) => other.videoId !== p.videoId);
        setState({ kind: "ready", list });
        onChange(list.length);
      })
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non si è riusciti a salvare la scelta. Riprova tra poco.");
      })
      .finally(() => setBusy(0));
  };

  return (
    <section className={`glass ${styles.rules}`} aria-label="Da confermare">
      <h2 className={styles.name}>Da confermare</h2>
      {state.kind === "loading" && <div className={styles.placeholder} aria-busy="true" />}
      {state.kind === "error" && (
        <p role="alert" className={styles.problem}>
          Il server non ha risposto. Ricarica la pagina tra poco.
        </p>
      )}
      {state.kind === "ready" && state.list.length === 0 && (
        <p className={styles.role}>
          Niente da confermare. Quando una fonte trova copertina e titolo di un video, compaiono
          qui.
        </p>
      )}
      {state.kind === "ready" && state.list.length > 0 && (
        <ul className={styles.list} aria-label="Proposte">
          {state.list.map((p) => (
            <li key={p.videoId} className={`glass ${styles.proposal}`}>
              <div className={styles.thumb}>
                {p.picture ? (
                  <img src={proposalPictureURL(p.videoId)} alt="" loading="lazy" />
                ) : (
                  <span>Nessuna immagine</span>
                )}
              </div>
              <div>
                <p className={styles.name}>{p.title || p.video}</p>
                <p className={styles.role}>
                  Per «{p.video}», da {names[p.source]}
                  {p.author && ` · ${p.author}`}
                  {p.date && ` · ${p.date}`}
                </p>
              </div>
              <span className={styles.buttons}>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy !== 0}
                  aria-label={`Usa la proposta per ${p.video}`}
                  onClick={() => decide(p, true)}
                >
                  Usa
                </button>
                <button
                  type="button"
                  className={`glass ${styles.action}`}
                  disabled={busy !== 0}
                  aria-label={`Scarta la proposta per ${p.video}`}
                  onClick={() => decide(p, false)}
                >
                  Scarta
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
    </section>
  );
}
