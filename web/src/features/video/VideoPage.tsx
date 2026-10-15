import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { type AudioTrack, fetchAudioStart, fetchAudioTracks } from "../../api/audio";
import { avatarUrl, maySharePublic } from "../../api/auth";
import { ApiError } from "../../api/client";
import { fetchProgress, saveProgress } from "../../api/progress";
import { fetchSimilar, reasonText } from "../../api/recommend";
import {
  fetchSubtitles,
  fetchVideo,
  type Owner,
  openVideoLink,
  playsFileItself,
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
import { morph } from "../../lib/motion";
import { loadSetting, saveSetting } from "../../lib/storage";
import { Comments } from "../comments/Comments";
import { LikeButton } from "../likes/LikeButton";
import { Player } from "../player/Player";
import { SaveButton } from "../playlists/SaveButton";
import { PublicLinkPanel } from "../public/PublicLinkPanel";
import { useSuggestions } from "../recommend/useSuggestions";
import { ShareButton } from "../share/ShareButton";
import { namesList } from "../sharing/audience";
import { CopyLink } from "../sharing/CopyLink";
import { VideoCard } from "../videos/VideoCard";
import { Description } from "./Description";
import { subtitleLabel } from "./subtitleLabel";
import { copyHint, useCopy } from "./useCopy";
import styles from "./VideoPage.module.css";

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ready"; video: Video; startAt: number };

// canPlayType asks this browser whether it can play a kind of video file.
function canPlayType(type: string): string {
  return document.createElement("video").canPlayType(type);
}

// VideoPage is where a video is watched: the player, its details, and
// the videos to watch after it next to it.
export function VideoPage() {
  const param = useParams().id ?? "";
  const id = /^\d+$/.test(param) ? Number(param) : 0;
  // key is the secret of the link of a video seen by link, when the
  // person came from one.
  const key = useSearchParams()[0].get("k");
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
    openLink(id, key)
      .then(() =>
        Promise.all([fetchVideo(id, controller.signal), startPosition(id, controller.signal)]),
      )
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
  }, [id, key]);

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
          {key === null
            ? "Questo video non esiste o non è più disponibile."
            : "Questo link non funziona più: chiedi un link nuovo a chi te l'ha mandato."}{" "}
          <Link to="/">Torna alla home</Link>
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

// openLink tells the server the person opened the link of a video, so
// they may watch it. A link that does not work any more is not a problem
// here: the video is then simply not found.
async function openLink(id: number, key: string | null): Promise<void> {
  if (key === null) return;
  try {
    await openVideoLink(id, key);
  } catch (error: unknown) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
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
  // The player grows or shrinks smoothly, and the column of next videos
  // glides to its new place, instead of jumping (morph).
  const toggle = useCallback(() => {
    morph(() =>
      setTheater((on) => {
        saveSetting("theater", !on);
        return !on;
      }),
    );
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
  const copy = useCopy(video, canPlayType);
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
          key={`${video.id}-${copy.round}`}
          src={streamURL(video.id, video.copy && playsFileItself(video, canPlayType))}
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
          unsupportedHint={copyHint(video, copy.state, copy.percent)}
          onUnsupported={copy.unsupported}
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
          {/* The category stands out as a chip, leading to its page. */}
          {video.category && (
            <Link
              to={`/categorie/${encodeURIComponent(video.category)}`}
              className={styles.category}
            >
              {video.category}
            </Link>
          )}
          <span>{details.join(" · ")}</span>
        </p>
        {video.private && <PrivateNote video={video} />}
        <PublicLinkFor video={video} />
        {video.description && (
          <div className={styles.below}>
            <Description text={video.description} />
          </div>
        )}
        <div className={`${styles.below} ${styles.comments}`}>
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
// where to change it, with its link to copy when it is seen by link; to
// someone it was shared with, that few see it.
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
  const change = (
    <>
      Per cambiare chi lo vede, vai a «I tuoi video» nella pagina{" "}
      <Link to="/carica">Carica un video</Link>.
    </>
  );
  if (video.link !== null) {
    return (
      <div className={`glass ${styles.private}`}>
        <p>Questo video lo vede solo chi ha il link: mandalo a chi vuoi tu. {change}</p>
        <CopyLink link={video.link} />
      </div>
    );
  }
  return (
    <p className={`glass ${styles.private}`}>
      {others.length === 0
        ? "Solo tu vedi questo video."
        : `Questo video lo vedete solo ${namesList(["tu", ...others])}.`}{" "}
      {change}
    </p>
  );
}

// PublicLinkFor shows the public link panel to who may make one for this
// video: its uploader, when the administrator allowed them, or an
// administrator, also for the videos of the folders.
function PublicLinkFor({ video }: { video: Video }) {
  const me = useAccount();
  const mine = me.role === "admin" || (video.uploader !== null && video.uploader.id === me.id);
  if (!mine || !maySharePublic(me)) return null;
  return <PublicLinkPanel videoId={video.id} />;
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
