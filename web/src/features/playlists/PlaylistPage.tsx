import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError } from "../../api/client";
import {
  deletePlaylist,
  fetchPlaylist,
  type PlaylistPage as Page,
  playlistName,
  putInPlaylist,
  renamePlaylist,
  sharePlaylist,
} from "../../api/playlists";
import { useAccount } from "../../app/auth";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { formatVideos } from "../../lib/format";
import { removeSmoothly } from "../../lib/motion";
import { type Choice, choiceOf, namesList, playlistSharing, ready } from "../sharing/audience";
import type { Hints } from "../sharing/WhoSees";
import { WhoSeesWindow } from "../sharing/WhoSeesWindow";
import { RemovableCard } from "../videos/RemovableCard";
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
// deleted, shown on my channel or shared with some people. Someone else's
// list, public or shared with me, can only be watched.
export function PlaylistPage() {
  const account = useAccount();
  const param = useParams().id ?? "";
  const id = /^\d+$/.test(param) ? Number(param) : 0;
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [now] = useState(() => new Date());
  const [mode, setMode] = useState<"view" | "rename" | "who" | "delete">("view");
  const [who, setWho] = useState<Choice>({ audience: "me", people: [] });
  const [problem, setProblem] = useState("");
  const whoButton = useRef<HTMLButtonElement>(null);
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

  const share = () => {
    if (!ready(who)) {
      setProblem("Scegli almeno una persona che potrà vederla.");
      return;
    }
    setProblem("");
    const { public: shown, sharedWith } = playlistSharing(who);
    sharePlaylist(playlist.id, { public: shown, sharedWith })
      .then(() => {
        // The page reads it again, for the names of the people chosen.
        return fetchPlaylist(playlist.id);
      })
      .then((page) => {
        setState({ kind: "ready", ...page });
        setMode("view");
      })
      .catch((error: unknown) => {
        console.error(error);
        setProblem(
          error instanceof ApiError && error.status === 400
            ? "Qualcuna delle persone scelte non c'è più: ricarica la pagina e scegli di nuovo."
            : "Non sono riuscito a cambiare chi vede la playlist. Riprova.",
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

  // takeOut lets the video fade away while the server takes it out of the
  // list; the videos below then glide up.
  const takeOut = (videoId: number, item: Element | null) => {
    setProblem("");
    removeSmoothly(
      item,
      async () => {
        await putInPlaylist(playlist.id, videoId, false);
      },
      () =>
        setState((s) =>
          s.kind === "ready"
            ? {
                ...s,
                playlist: { ...s.playlist, videos: s.playlist.videos - 1 },
                videos: s.videos.filter((v) => v.id !== videoId),
              }
            : s,
        ),
    ).catch((error: unknown) => {
      console.error(error);
      setProblem("Non sono riuscito a togliere il video. Riprova.");
    });
  };

  return (
    <div className={styles.page}>
      <p className={styles.back}>
        {mine ? (
          <Link to="/playlist" className="glass">
            <Icon name="chevronLeft" size={20} />
            Tutte le playlist
          </Link>
        ) : !playlist.public ? (
          <Link to="/condivisi" className="glass">
            <Icon name="chevronLeft" size={20} />
            Condivisi con te
          </Link>
        ) : (
          <Link to={`/canale/${playlist.owner.id}`} className="glass">
            <Icon name="chevronLeft" size={20} />
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
                !later && ` · ${seenByText(playlist.public, playlist.sharedWith)}`
              ) : (
                <>
                  {" · di "}
                  <Link to={`/canale/${playlist.owner.id}`}>{playlist.owner.name}</Link>
                </>
              )}
            </p>
          </div>
          {mine && !later && (mode === "view" || mode === "who") && (
            <div className={styles.buttons}>
              <button
                ref={whoButton}
                type="button"
                className={`glass ${styles.action}`}
                aria-expanded={mode === "who"}
                onClick={() => {
                  if (mode === "who") {
                    setMode("view");
                    return;
                  }
                  setWho(choiceOf(!playlist.public, playlist.sharedWith));
                  setProblem("");
                  setMode("who");
                }}
              >
                <Icon name="channel" size={18} />
                Chi la vede
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
      {problem && mode !== "who" && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
      {mine && !later && (
        <WhoSeesWindow
          open={mode === "who"}
          button={whoButton}
          title="Chi la vede"
          choice={who}
          onChange={setWho}
          hints={playlistHints}
          problem={problem}
          onSave={share}
          onClose={() => {
            setProblem("");
            setMode((m) => (m === "who" ? "view" : m));
          }}
        />
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
            <li key={video.id} data-flip>
              {mine ? (
                <RemovableCard
                  card={<VideoCard video={video} now={now} layout="row" />}
                  label={`Togli «${video.title}» dalla playlist`}
                  title="Togli dalla playlist"
                  onRemove={(event) => takeOut(video.id, event.currentTarget.closest("li"))}
                />
              ) : (
                <VideoCard video={video} now={now} layout="row" />
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// playlistHints say what each choice of who sees it means for a playlist.
const playlistHints: Hints = {
  everyone: "Sta sul tuo canale: la vede chiunque usi FranzPLAY.",
  me: "Non la vede nessun altro.",
  people:
    "La vedono solo le persone che scegli, nella pagina «Condivisi con te». I video privati non ci finiscono mai.",
};

// seenByText says who sees one of my lists.
function seenByText(isPublic: boolean, sharedWith: { name: string }[]): string {
  if (isPublic) return "sul tuo canale, la vedono tutti";
  if (sharedWith.length === 0) return "solo per te";
  return `la vedono anche ${namesList(sharedWith.map((p) => p.name))}`;
}
