import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router";
import { ApiError } from "../../api/client";
import {
  fetchPublicSubtitles,
  fetchPublicVideo,
  isPublicKey,
  type PublicVideo,
} from "../../api/publicLinks";
import type { SubtitleTrack } from "../../api/videos";
import { useAuth } from "../../app/auth";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { SiteName } from "../../components/SiteName";
import { formatDate } from "../../lib/format";
import { AuthPage } from "../auth/AuthPage";
import { Player } from "../player/Player";
import { Description } from "../video/Description";
import { GuestDialog } from "./GuestDialog";
import styles from "./Public.module.css";

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ready"; video: PublicVideo; subtitles: SubtitleTrack[] };

// publicKeyOf reads the key of a public address, /p/{key}; "" if it is not one.
export function publicKeyOf(pathname: string): string {
  const key = pathname.match(/^\/p\/([^/]+)\/?$/)?.[1] ?? "";
  return isPublicKey(key) ? key : "";
}

// canPlayType asks this browser whether it can play a kind of video file.
function canPlayType(type: string): string {
  return document.createElement("video").canPlayType(type);
}

// PublicVideoPage shows the video of a public link to anybody, logged in
// or not: the player, the title and the description, and nothing else of
// FranzPLAY. A guest who tries to like, save or comment is asked to log
// in; after logging in, a person who may open the video anyway goes to
// its usual page.
export function PublicVideoPage() {
  const key = publicKeyOf(useLocation().pathname);
  const { state: auth } = useAuth();
  const signedIn = auth.kind === "signed-in";
  const [state, setState] = useState<State>({ kind: "loading" });
  const [asking, setAsking] = useState(false);
  const [entering, setEntering] = useState<"login" | "register" | null>(null);
  usePageTitle(
    state.kind === "ready"
      ? state.video.title
      : state.kind === "missing"
        ? "Video non trovato"
        : "",
  );

  useEffect(() => {
    void signedIn; // after logging in, ask again: the answer may name the video
    if (key === "") {
      setState({ kind: "missing" });
      return;
    }
    const controller = new AbortController();
    Promise.all([
      fetchPublicVideo(key, controller.signal),
      fetchPublicSubtitles(key, controller.signal).catch((error: unknown) => {
        if (!controller.signal.aborted) console.error(error);
        return [];
      }),
    ])
      .then(([video, subtitles]) => setState({ kind: "ready", video, subtitles }))
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
  }, [key, signedIn]);

  const openRegistration = auth.kind === "signed-out" && auth.openRegistration;

  if (entering !== null && !signedIn) {
    return (
      <AuthPage
        mode={entering === "register" && openRegistration ? "register" : "login"}
        openRegistration={openRegistration}
        onBack={() => setEntering(null)}
      />
    );
  }
  if (signedIn && state.kind === "ready" && state.video.videoId !== null) {
    return <Navigate to={`/video/${state.video.videoId}`} replace />;
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.logo}>
          <SiteName accentClass={styles.accent} />
        </span>
        {!signedIn && (
          <button type="button" className={styles.primary} onClick={() => setEntering("login")}>
            Accedi
          </button>
        )}
      </header>
      <main className={styles.main}>
        {state.kind === "loading" && <div className={styles.placeholder} aria-busy="true" />}
        {state.kind === "missing" && (
          <EmptyState title="Video non trovato" headingLevel={1}>
            Questo link non funziona più, o non è mai esistito: chiedine uno nuovo a chi te l'ha
            mandato.
          </EmptyState>
        )}
        {state.kind === "error" && (
          <EmptyState title="Video non disponibile" headingLevel={1}>
            Il server non ha risposto. Ricarica la pagina tra poco.
          </EmptyState>
        )}
        {state.kind === "ready" && (
          <Watch
            video={state.video}
            subtitles={state.subtitles}
            guest={!signedIn}
            onAsk={() => setAsking(true)}
          />
        )}
      </main>
      {asking && !signedIn && (
        <GuestDialog
          openRegistration={openRegistration}
          onClose={() => setAsking(false)}
          onLogin={() => {
            setAsking(false);
            setEntering("login");
          }}
          onRegister={() => {
            setAsking(false);
            setEntering("register");
          }}
        />
      )}
    </div>
  );
}

function Watch({
  video,
  subtitles,
  guest,
  onAsk,
}: {
  video: PublicVideo;
  subtitles: SubtitleTrack[];
  guest: boolean;
  onAsk: () => void;
}) {
  const original =
    video.copy && video.fileType !== "" && canPlayType(video.fileType) === "probably";
  const details = [
    video.author,
    video.publishedOn ? formatDate(new Date(`${video.publishedOn}T12:00:00`)) : "",
    video.height !== null && video.width !== null ? `${Math.min(video.width, video.height)}p` : "",
    video.format,
  ].filter(Boolean);
  return (
    <article className={styles.watch}>
      <Player
        src={`${video.stream}${original ? "?original=1" : ""}`}
        poster={video.cover}
        subtitles={subtitles}
        preview={video.preview}
        length={video.duration}
      />
      <h1 className={styles.title}>{video.title}</h1>
      <div className={styles.bar}>
        {video.owner && <p className={styles.owner}>Condiviso da {video.owner}</p>}
        {/* A guest sees the buttons of everybody else: pressing one tells
            them an account is needed. */}
        {guest && (
          <div className={styles.actions}>
            <button type="button" className={`glass ${styles.pill}`} onClick={onAsk}>
              <Icon name="like" size={20} />
              Mi piace
            </button>
            <button type="button" className={`glass ${styles.pill}`} onClick={onAsk}>
              <Icon name="save" size={20} />
              Salva
            </button>
            <button type="button" className={`glass ${styles.pill}`} onClick={onAsk}>
              <Icon name="edit" size={20} />
              Commenta
            </button>
          </div>
        )}
      </div>
      {details.length > 0 && <p className={styles.details}>{details.join(" · ")}</p>}
      {video.description && (
        <div className={styles.below}>
          <Description text={video.description} />
        </div>
      )}
      <p className={`glass ${styles.note}`}>
        <Icon name="globe" size={16} />
        Stai guardando questo video con un link pubblico: vedi solo questo video.
      </p>
    </article>
  );
}
