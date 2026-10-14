import { useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import type { VideoListState } from "./useVideoList";
import { VideoCard } from "./VideoCard";
import styles from "./VideoGrid.module.css";

type VideoGridProps = {
  state: VideoListState;
  onMore: () => void;
  label: string; // for screen readers: what the list is
  empty: { title: string; text: string };
};

// VideoGrid shows a list of videos as a grid of cards, with a button to
// see more when there are more.
export function VideoGrid({ state, onMore, label, empty }: VideoGridProps) {
  // The same "now" for every card, so they all agree on what "today" is.
  const [now] = useState(() => new Date());

  switch (state.kind) {
    case "loading":
      return (
        <div className={styles.grid} aria-busy="true">
          <p className="visually-hidden">Carico i video…</p>
          {Array.from({ length: 8 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have nothing else to tell them apart
            <div key={i} className={styles.placeholder} />
          ))}
        </div>
      );
    case "error":
      return (
        <EmptyState title="Video non disponibili">
          Il server non ha risposto. Ricarica la pagina tra poco.
        </EmptyState>
      );
    case "ready":
      if (state.videos.length === 0) {
        return <EmptyState title={empty.title}>{empty.text}</EmptyState>;
      }
      return (
        <>
          <ul className={`stagger ${styles.grid}`} aria-label={label}>
            {state.videos.map((video) => (
              <li key={video.id}>
                <VideoCard video={video} now={now} />
              </li>
            ))}
          </ul>
          {state.videos.length < state.total && (
            <div className={styles.more}>
              <button
                type="button"
                className={`glass ${styles.moreButton}`}
                onClick={onMore}
                disabled={state.more === "loading"}
              >
                {state.more === "loading" ? "Carico…" : "Mostra altri video"}
              </button>
              {state.more === "error" && (
                <p role="alert" className={styles.moreError}>
                  Non sono riuscito a caricare altri video. Riprova.
                </p>
              )}
            </div>
          )}
        </>
      );
  }
}
