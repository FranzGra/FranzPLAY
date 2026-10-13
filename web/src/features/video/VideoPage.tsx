import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { type AudioTrack, fetchAudioStart, fetchAudioTracks } from "../../api/audio";
import { avatarUrl } from "../../api/auth";
import { ApiError } from "../../api/client";
import { fetchProgress, saveProgress } from "../../api/progress";
import { fetchSimilar, reasonText } from "../../api/recommend";
import {
  fetchSubtitles,
  fetchVideo,
  type Owner,
  type SubtitleTrack,
  streamURL,
  type Video,
} from "../../api/videos";
import { useAccount } from "../../app/auth";
import { usePageWidth } from "../../app/pageWidth";
import { Avatar } from "../../components/Avatar";
import { EmptyState } from "../../components/EmptyState";
import { usePageTitle } from "../../components/PageTitle";
import { formatAge, formatDate } from "../../lib/format";
import { loadSetting, saveSetting } from "../../lib/storage";
import { Comments } from "../comments/Comments";
import { LikeButton } from "../likes/LikeButton";
import { Player } from "../player/Player";
import { SaveButton } from "../playlists/SaveButton";
import { useSuggestions } from "../recommend/useSuggestions";
import { ShareButton } from "../share/ShareButton";
import { namesList } from "../sharing/audience";
import { VideoCard } from "../videos/VideoCard";
import { Description } from "./Description";
import { subtitleLabel } from "./subtitleLabel";
import styles from "./VideoPage.module.css";

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ready"; video: Video; startAt: number };

// VideoPage is where a video is watched: the player, its details, and
// the videos to watch after it next to it.
export function VideoPage() {
  const param = useParams().id ?? "";
  const id = /^\d+$/.test(param) ? Number(param) : 0;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [theater, toggleTheater] = useTheater();
  usePageWidth(theater ? "full" : "wide");
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
    Promise.all([fetchVideo(id, controller.signal), startPosition(id, controller.signal)])
      .then(([video, startAt]) => setState({ kind: "ready", video, startAt }))
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
      return (
        <div className={layoutClass(theater, false)}>
          <div className={styles.player}>
            <div className={styles.placeholder} aria-busy="true" />
          </div>
        </div>
      );
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
      return (
        <Watch
          video={state.video}
          startAt={state.startAt}
          theater={theater}
          onTheater={toggleTheater}
        />
      );
  }
}

// layoutClass arranges the page: the player on the left with the videos
// to watch next on its right, like on YouTube; in theater mode the player
// spans the whole width above them. A private video suggests nothing
// else, so it has no column on the right.
function layoutClass(theater: boolean, alone: boolean): string {
  return [styles.root, theater && styles.theater, alone && styles.alone].filter(Boolean).join(" ");
}

function parseTheater(data: unknown): boolean {
  if (typeof data !== "boolean") throw new Error("theater: not true or false");
  return data;
}

// useTheater is theater mode, on or off, remembered in this browser for
// the next videos, like on YouTube.
function useTheater(): [boolean, () => void] {
  const [theater, setTheater] = useState(() => loadSetting("theater", parseTheater, false));
  const toggle = useCallback(() => {
    setTheater((on) => {
      saveSetting("theater", !on);
      return !on;
    });
  }, []);
  return [theater, toggle];
}

// startPosition is where to start the video: where the person stopped,
// or the beginning. Without it the video still plays, so a failure only
// goes to the console.
async function startPosition(id: number, signal: AbortSignal): Promise<number> {
  try {
    return (await fetchProgress(id, signal)).position;
  } catch (error) {
    if (!signal.aborted) console.error(error);
    return 0;
  }
}

function Watch({
  video,
  startAt,
  theater,
  onTheater,
}: {
  video: Video;
  startAt: number;
  theater: boolean;
  onTheater: () => void;
}) {
  const [now] = useState(() => new Date());
  const subtitles = useSubtitles(video.id);
  const audio = useAudio(video.id);
  const findAudio = useCallback(
    (stream: number, at: number) => fetchAudioStart(video.id, stream, at),
    [video.id],
  );
  const remember = useCallback(
    (seconds: number) => {
      saveProgress(video.id, seconds).catch((error: unknown) => console.error(error));
    },
    [video.id],
  );
  const details = [
    video.author,
    video.publishedOn ? formatDate(video.publishedOn) : formatAge(video.addedAt, now),
    video.height !== null && video.width !== null ? `${Math.min(video.width, video.height)}p` : "",
    video.format,
    subtitleLabel(subtitles),
  ].filter(Boolean);

  return (
    <div className={layoutClass(theater, video.private)}>
      <div className={styles.player}>
        <Player
          key={video.id}
          src={streamURL(video.id)}
          poster={video.cover}
          subtitles={subtitles}
          startAt={startAt}
          onPosition={video.private ? undefined : remember}
          preview={video.preview}
          audio={audio}
          findAudio={findAudio}
          length={video.duration}
          autoPlay
          theater={theater}
          onTheater={onTheater}
          unsupportedHint={
            video.playable
              ? undefined
              : "Il formato di questo video non è adatto a tutti i browser. FranzPLAY ne sta preparando una copia che si vede ovunque: riprova più tardi."
          }
        />
      </div>
      <div className={styles.info}>
        <h1 className={styles.title}>{video.title}</h1>
        <div className={styles.bar}>
          {video.owner && <OwnerLink owner={video.owner} />}
          <div className={styles.actions}>
            <LikeButton videoId={video.id} />
            {/* A private video opens only for its few people: a playlist or
                a link would lead the others to a page that does not open. */}
            {!video.private && (
              <>
                <SaveButton videoId={video.id} />
                <ShareButton title={video.title} path={`/video/${video.id}`} />
              </>
            )}
          </div>
        </div>
        <p className={styles.details}>
          {video.category && (
            <>
              <Link to={`/categorie/${encodeURIComponent(video.category)}`}>{video.category}</Link>
              {" · "}
            </>
          )}
          {details.join(" · ")}
        </p>
        {video.private && <PrivateNote video={video} />}
        {video.description && (
          <div className={styles.below}>
            <Description text={video.description} />
          </div>
        )}
        <div className={styles.below}>
          <Comments key={video.id} videoId={video.id} />
        </div>
      </div>
      {!video.private && (
        <aside className={styles.side} aria-label="Altri video">
          <UpNext video={video} now={now} />
        </aside>
      )}
    </div>
  );
}

// OwnerLink is whose the video is, with their photo, leading to their
// channel: the person who uploaded it, or the main administrator for a
// video from a folder.
function OwnerLink({ owner }: { owner: Owner }) {
  return (
    <Link to={`/canale/${owner.id}`} className={styles.owner}>
      <Avatar name={owner.name} photo={avatarUrl(owner.id, owner.avatar)} />
      <span className={styles.ownerName}>{owner.name}</span>
    </Link>
  );
}

// PrivateNote says who sees a private video: to its uploader, who else and
// where to change it; to someone it was shared with, that few see it.
function PrivateNote({ video }: { video: Video }) {
  const me = useAccount();
  if (video.uploader !== null && video.uploader.id !== me.id) {
    return (
      <p className={`glass ${styles.private}`}>
        {video.uploader.name} ha condiviso questo video solo con alcune persone, tra cui te. Gli
        altri non lo vedono.
      </p>
    );
  }
  const others = video.sharedWith.map((p) => p.name);
  return (
    <p className={`glass ${styles.private}`}>
      {others.length === 0
        ? "Solo tu vedi questo video."
        : `Questo video lo vedete solo ${namesList(["tu", ...others])}.`}{" "}
      Per cambiare chi lo vede, vai a «I tuoi video» nella pagina{" "}
      <Link to="/carica">Carica un video</Link>.
    </p>
  );
}

// UpNext lists the videos to watch after this one, each saying why.
function UpNext({ video, now }: { video: Video; now: Date }) {
  const load = useCallback((signal: AbortSignal) => fetchSimilar(video.id, signal), [video.id]);
  const similar = useSuggestions(load);
  if (similar.length === 0) return null;
  return (
    <>
      <h2 className={styles.sideTitle}>Da guardare dopo</h2>
      <ul className={`stagger ${styles.list}`}>
        {similar.map((s) => (
          <li key={s.video.id}>
            <VideoCard video={s.video} now={now} layout="row" note={reasonText(s)} />
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

const noAudio: AudioTrack[] = [];

// useAudio loads the sound tracks of a video, when there is a choice of
// language. Without them the video still plays in its own language.
function useAudio(id: number): AudioTrack[] {
  const [tracks, setTracks] = useState<AudioTrack[]>(noAudio);
  useEffect(() => {
    const controller = new AbortController();
    setTracks(noAudio);
    fetchAudioTracks(id, controller.signal)
      .then(setTracks)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, [id]);
  return tracks;
}
