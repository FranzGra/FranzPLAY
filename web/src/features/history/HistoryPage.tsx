import { useState } from "react";
import type { Watched } from "../../api/progress";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { formatDay } from "../../lib/format";
import { removeAllSmoothly, removeSmoothly } from "../../lib/motion";
import { VideoCard } from "../videos/VideoCard";
import styles from "./HistoryPage.module.css";
import { useHistory } from "./useHistory";

// HistoryPage lists the videos the person watched, most recent first,
// grouped by day. Each can be removed, or the whole history emptied: what
// goes fades away and what stays glides into its place.
export function HistoryPage() {
  usePageTitle("Cronologia");
  const { state, loadMore, forget, drop, clear, empty } = useHistory();
  const [now] = useState(() => new Date());
  const [problem, setProblem] = useState("");

  const run = (action: () => Promise<void>, failure: string) => {
    setProblem("");
    action().catch((error: unknown) => {
      console.error(error);
      setProblem(failure);
    });
  };

  return (
    <>
      <div className={styles.top}>
        <h1 className={styles.heading}>
          <Icon name="history" size={26} />
          Cronologia
        </h1>
        {state.kind === "ready" && state.items.length > 0 && (
          <ClearButton
            onClear={() =>
              run(
                () =>
                  removeAllSmoothly(document.querySelectorAll("[data-history-item]"), clear, empty),
                "Non sono riuscito a cancellare la cronologia. Riprova.",
              )
            }
          />
        )}
      </div>
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
      {state.kind === "loading" && <div className={styles.placeholder} aria-busy="true" />}
      {state.kind === "error" && (
        <EmptyState title="Cronologia non disponibile">
          Il server non ha risposto. Ricarica la pagina tra poco.
        </EmptyState>
      )}
      {state.kind === "ready" && state.items.length === 0 && (
        <EmptyState title="Nessun video visto">
          I video che guardi compariranno qui, dal più recente, così ritrovi facilmente quello che
          hai visto.
        </EmptyState>
      )}
      {state.kind === "ready" &&
        byDay(state.items, now).map(({ day, items }) => (
          <section key={day} className={styles.day} aria-label={day}>
            <h2 className={styles.dayTitle} data-flip>
              {day}
            </h2>
            <ul className={`stagger ${styles.list}`}>
              {items.map((w) => (
                <li key={w.video.id} className={styles.item} data-flip data-history-item>
                  <VideoCard
                    video={w.video}
                    now={now}
                    layout="row"
                    position={w.finished ? (w.video.duration ?? undefined) : w.position}
                  />
                  <button
                    type="button"
                    className={styles.remove}
                    aria-label={`Togli «${w.video.title}» dalla cronologia`}
                    title="Togli dalla cronologia"
                    onClick={(event) => {
                      const item = event.currentTarget.closest("li");
                      run(
                        () =>
                          removeSmoothly(
                            item,
                            () => forget(w.video.id),
                            () => drop(w.video.id),
                          ),
                        "Non sono riuscito a togliere il video dalla cronologia. Riprova.",
                      );
                    }}
                  >
                    <Icon name="close" size={18} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      {state.kind === "ready" && state.items.length < state.total && (
        <div className={styles.more} data-flip>
          <button
            type="button"
            className={`glass ${styles.moreButton}`}
            onClick={loadMore}
            disabled={state.more === "loading"}
          >
            {state.more === "loading" ? "Carico…" : "Mostra altri video"}
          </button>
          {state.more === "error" && (
            <p role="alert" className={styles.problem}>
              Non sono riuscito a caricare altri video. Riprova.
            </p>
          )}
        </div>
      )}
    </>
  );
}

// ClearButton asks once more before emptying the whole history.
function ClearButton({ onClear }: { onClear: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={`glass ${styles.action}`} onClick={() => setAsking(true)}>
        <Icon name="trash" size={18} />
        Cancella cronologia
      </button>
    );
  }
  return (
    <div className={styles.confirm}>
      <span>Cancellare tutta la cronologia?</span>
      <button
        type="button"
        className={`${styles.action} ${styles.danger}`}
        onClick={() => {
          setAsking(false);
          onClear();
        }}
      >
        Sì, cancella
      </button>
      <button type="button" className={`glass ${styles.action}`} onClick={() => setAsking(false)}>
        Annulla
      </button>
    </div>
  );
}

// byDay groups the history by the day each video was watched, keeping
// the order.
export function byDay(items: Watched[], now: Date): { day: string; items: Watched[] }[] {
  const groups: { day: string; items: Watched[] }[] = [];
  for (const w of items) {
    const day = formatDay(w.watchedAt, now);
    const last = groups.at(-1);
    if (last?.day === day) {
      last.items.push(w);
    } else {
      groups.push({ day, items: [w] });
    }
  }
  return groups;
}
