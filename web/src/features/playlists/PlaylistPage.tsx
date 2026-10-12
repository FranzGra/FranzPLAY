import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError } from "../../api/client";
import {
  deletePlaylist,
  fetchPlaylist,
  type PlaylistPage as Page,
  playlistName,
  publishPlaylist,
  putInPlaylist,
  renamePlaylist,
} from "../../api/playlists";
import { useAccount } from "../../app/auth";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { formatVideos } from "../../lib/format";
import { VideoCard } from "../videos/VideoCard";
import { NameForm } from "./NameForm";
import styles from "./Playlists.module.css";

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error" }
  | ({ kind: "ready" } & Page);

// PlaylistPage shows a list with its videos, in order. On one of my
// lists any video can be taken out, and an ordinary list can be renamed,
// deleted or shown on my channel. Someone else's public list can only be
// watched.
export function PlaylistPage() {
  const account = useAccount();
  const param = useParams().id ?? "";
  const id = /^\d+$/.test(param) ? Number(param) : 0;
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [now] = useState(() => new Date());
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  const [problem, setProblem] = useState("");
  usePageTitle(
    state.kind === "ready"
      ? playlistName(state.playlist)
      : state.kind === "missing"
        ? "Playlist non trovata"
        : "",
  );

  useEffect(() => {
    if (id <= 0) {
      setState({ kind: "missing" });
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetchPlaylist(id, controller.signal)
      .then((page) => setState({ kind: "ready", ...page }))
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

  if (state.kind === "loading") return <div className={styles.placeholder} aria-busy="true" />;
  if (state.kind === "missing") {
    return (
      <EmptyState title="Playlist non trovata" headingLevel={1}>
        Questa playlist non esiste più. <Link to="/playlist">Torna alle playlist</Link>
      </EmptyState>
    );
  }
  if (state.kind === "error") {
    return (
      <EmptyState title="Playlist non disponibile" headingLevel={1}>
        Il server non ha risposto. Ricarica la pagina tra poco.
      </EmptyState>
    );
  }

  const { playlist, videos } = state;
  const later = playlist.kind === "later";
  const mine = playlist.owner.id === account.id;

  const publish = () => {
    const shown = !playlist.public;
    setProblem("");
    publishPlaylist(playlist.id, shown)
      .then(() =>
        setState((s) =>
          s.kind === "ready" ? { ...s, playlist: { ...s.playlist, public: shown } } : s,
        ),
      )
      .catch((error: unknown) => {
        console.error(error);
        setProblem(
          shown
            ? "Non sono riuscito a mettere la playlist sul canale. Riprova."
            : "Non sono riuscito a togliere la playlist dal canale. Riprova.",
        );
      });
  };

  const rename = async (name: string) => {
    await renamePlaylist(playlist.id, name);
    setState({ ...state, playlist: { ...playlist, name: name.trim().replace(/\s+/g, " ") } });
    setMode("view");
  };

  const remove = () => {
    setMode("view");
    setProblem("");
    deletePlaylist(playlist.id)
      .then(() => navigate("/playlist"))
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non sono riuscito a eliminare la playlist. Riprova.");
      });
  };

  const takeOut = (videoId: number) => {
    setProblem("");
    putInPlaylist(playlist.id, videoId, false)
      .then(() =>
        setState((s) =>
          s.kind === "ready"
            ? {
                ...s,
                playlist: { ...s.playlist, videos: s.playlist.videos - 1 },
                videos: s.videos.filter((v) => v.id !== videoId),
              }
            : s,
        ),
      )
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non sono riuscito a togliere il video. Riprova.");
      });
  };

  return (
    <>
      <p className={styles.back}>
        {mine ? (
          <Link to="/playlist">
            <Icon name="chevronLeft" size={16} />
            Tutte le playlist
          </Link>
        ) : (
          <Link to={`/canale/${playlist.owner.id}`}>
            <Icon name="chevronLeft" size={16} />
            Canale di {playlist.owner.name}
          </Link>
        )}
      </p>
      {mode === "rename" ? (
        <NameForm
          initial={playlist.name}
          submit="Salva"
          failure="Non sono riuscito a rinominare la playlist. Riprova."
          onSubmit={rename}
          onCancel={() => setMode("view")}
        />
      ) : (
        <div className={styles.top}>
          <div>
            <h1 className={styles.heading}>
              {later && <Icon name="clock" size={26} />}
              {playlistName(playlist)}
            </h1>
            <p className={styles.subtitle}>
              {formatVideos(playlist.videos)}
              {mine ? (
                !later &&
                (playlist.public ? " · sul tuo canale, la vedono tutti" : " · solo per te")
              ) : (
                <>
                  {" · di "}
                  <Link to={`/canale/${playlist.owner.id}`}>{playlist.owner.name}</Link>
                </>
              )}
            </p>
          </div>
          {mine && !later && mode === "view" && (
            <div className={styles.buttons}>
              <button
                type="button"
                className={`glass ${styles.action} ${playlist.public ? styles.on : ""}`}
                aria-pressed={playlist.public}
                onClick={publish}
              >
                <Icon name="channel" size={18} />
                Sul mio canale
              </button>
              <button
                type="button"
                className={`glass ${styles.action}`}
                onClick={() => setMode("rename")}
              >
                <Icon name="edit" size={18} />
                Rinomina
              </button>
              <button
                type="button"
                className={`glass ${styles.action}`}
                onClick={() => setMode("delete")}
              >
                <Icon name="trash" size={18} />
                Elimina
              </button>
            </div>
          )}
          {mode === "delete" && (
            <div className={styles.buttons}>
              <span>Eliminare la playlist? I video restano nella libreria.</span>
              <button
                type="button"
                className={`${styles.action} ${styles.danger}`}
                onClick={remove}
              >
                Sì, elimina
              </button>
              <button
                type="button"
                className={`glass ${styles.action}`}
                onClick={() => setMode("view")}
              >
                Annulla
              </button>
            </div>
          )}
        </div>
      )}
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
      {videos.length === 0 ? (
        <EmptyState title={later ? "Niente da guardare più tardi" : "Playlist vuota"}>
          {mine ? (
            <>
              Sotto ogni video premi <strong>Salva</strong> e scegli{" "}
              {later ? "«Guarda più tardi»" : "questa playlist"}: il video comparirà qui.
            </>
          ) : (
            `Quando ${playlist.owner.name} aggiungerà dei video, li vedrai qui.`
          )}
        </EmptyState>
      ) : (
        <ol className={styles.videos}>
          {videos.map((video) => (
            <li key={video.id} className={styles.item}>
              <VideoCard video={video} now={now} layout="row" />
              {mine && (
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={`Togli «${video.title}» dalla playlist`}
                  title="Togli dalla playlist"
                  onClick={() => takeOut(video.id)}
                >
                  <Icon name="close" size={20} />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
