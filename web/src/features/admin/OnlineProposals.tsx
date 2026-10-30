import { useEffect, useState } from "react";
import {
  acceptProposal,
  discardProposal,
  fetchProposals,
  type Proposal,
  proposalPictureURL,
  type SourceName,
} from "../../api/online";
import { Icon } from "../../components/Icon";
import pages from "./Pages.module.css";
import { Card, Loading, ui } from "./ui";

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
    <Card
      title="Da confermare"
      icon="check"
      sub={state.kind === "ready" && state.list.length > 0 ? `${state.list.length}` : undefined}
    >
      {state.kind === "loading" && <Loading />}
      {state.kind === "error" && (
        <p role="alert" className={ui.problem}>
          Il server non ha risposto. Ricarica la pagina tra poco.
        </p>
      )}
      {state.kind === "ready" && state.list.length === 0 && (
        <p className={ui.cardText}>
          Niente da confermare. Quando una fonte trova copertina e titolo di un video, compaiono
          qui.
        </p>
      )}
      {state.kind === "ready" && state.list.length > 0 && (
        <ul className={pages.proposals} aria-label="Proposte">
          {state.list.map((p) => (
            <li key={p.videoId} className={pages.proposal}>
              <div className={ui.thumb}>
                {p.picture ? (
                  <img src={proposalPictureURL(p.videoId)} alt="" loading="lazy" />
                ) : (
                  <span className={pages.noPicture}>
                    <Icon name="image" size={20} />
                    Nessuna immagine
                  </span>
                )}
              </div>
              <div className={ui.rowMain}>
                <b>{p.title || p.video}</b>
                <span>
                  Per «{p.video}», da {names[p.source]}
                  {p.author && ` · ${p.author}`}
                  {p.date && ` · ${p.date}`}
                </span>
                <span className={ui.chips}>
                  <button
                    type="button"
                    className={`${ui.btn} ${ui.small} ${ui.primary}`}
                    disabled={busy !== 0}
                    aria-label={`Usa la proposta per ${p.video}`}
                    onClick={() => decide(p, true)}
                  >
                    Usa
                  </button>
                  <button
                    type="button"
                    className={`${ui.btn} ${ui.small} ${ui.ghost}`}
                    disabled={busy !== 0}
                    aria-label={`Scarta la proposta per ${p.video}`}
                    onClick={() => decide(p, false)}
                  >
                    Scarta
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {problem && (
        <p role="alert" className={ui.problem}>
          {problem}
        </p>
      )}
    </Card>
  );
}
