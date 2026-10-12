import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { ApiError } from "../../api/client";
import {
  fetchSubtitles,
  fetchVideo,
  type SubtitleTrack,
  streamURL,
  type Video,
} from "../../api/videos";
import { EmptyState } from "../../components/EmptyState";
import { usePageTitle } from "../../components/PageTitle";
import { formatAge } from "../../lib/format";
import { Player } from "../player/Player";
import { useVideoList } from "../videos/useVideoList";
import { VideoCard } from "../videos/VideoCard";
import styles from "./VideoPage.module.css";

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ready"; video: Video };

// VideoPage is where a video is watched: the player, its details, and
// other videos of the same category next to it.
export function VideoPage() {
  const param = useParams().id ?? "";
  const id = /^\d+$/.test(param) ? Number(param) : 0;
  const [state, setState] = useState<State>({ kind: "loading" });
  usePageTitle(
    state.kind === "ready"
      ? state.video.title
      : state.kind === "missing"
        ? "Video non trovato"
        : "",
  );

  useEffect(() => {
    if (id <= 0) {
      setState({ kind: "missing" });
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetchVideo(id, controller.signal)
      .then((video) => setState({ kind: "ready", video }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 404) {
          setState({ kind: "missing" });
          return;
        }
        console.error(error);
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, [id]);

  switch (state.kind) {
    case "loading":
      return <div className={styles.placeholder} aria-busy="true" />;
    case "missing":
      return (
        <EmptyState title="Video non trovato" headingLevel={1}>
          Questo video non esiste o non è più disponibile. <Link to="/">Torna alla home</Link>
        </EmptyState>
      );
    case "error":
      return (
        <EmptyState title="Video non disponibile" headingLevel={1}>
          Il server non ha risposto. Ricarica la pagina tra poco.
        </EmptyState>
      );
    case "ready":
      return <Watch video={state.video} />;
  }
}

function Watch({ video }: { video: Video }) {
  const [now] = useState(() => new Date());
  const subtitles = useSubtitles(video.id);
  const details = [
    formatAge(video.addedAt, now),
    video.height !== null && video.width !== null ? `${Math.min(video.width, video.height)}p` : "",
  ].filter(Boolean);

  return (
    <div className={styles.root}>
      <div className={styles.main}>
        <Player
          key={video.id}
          src={streamURL(video.id)}
          poster={video.cover}
          subtitles={subtitles}
          unsupportedHint={
            video.playable
              ? undefined
              : "Il formato di questo video non è adatto ai browser. FranzPLAY imparerà presto a convertirlo da solo."
          }
        />
        <h1 className={styles.title}>{video.title}</h1>
        <p className={styles.details}>
          {video.category && (
            <>
              <Link to={`/categorie/${encodeURIComponent(video.category)}`}>{video.category}</Link>
              {" · "}
            </>
          )}
          {details.join(" · ")}
        </p>
      </div>
      <aside className={styles.side} aria-label="Altri video">
        <UpNext video={video} now={now} />
      </aside>
    </div>
  );
}

// UpNext lists other videos of the same category (or the newest ones).
function UpNext({ video, now }: { video: Video; now: Date }) {
  const { state } = useVideoList({ category: video.category });
  if (state.kind !== "ready") return null;
  const others = state.videos.filter((v) => v.id !== video.id);
  if (others.length === 0) return null;
  return (
    <>
      <h2 className={styles.sideTitle}>
        {video.category ? `Altri video di ${video.category}` : "Altri video"}
      </h2>
      <ul className={styles.list}>
        {others.map((v) => (
          <li key={v.id}>
            <VideoCard video={v} now={now} layout="row" />
          </li>
        ))}
      </ul>
    </>
  );
}

const none: SubtitleTrack[] = [];

// useSubtitles loads the subtitles of a video. Without them the video
// still plays, so a failure only goes to the console.
function useSubtitles(id: number): SubtitleTrack[] {
  const [tracks, setTracks] = useState<SubtitleTrack[]>(none);
  useEffect(() => {
    const controller = new AbortController();
    setTracks(none);
    fetchSubtitles(id, controller.signal)
      .then(setTracks)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, [id]);
  return tracks;
}
