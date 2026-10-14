import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  type AdminShow,
  type AdminVideo,
  fetchAdminVideos,
  refreshVideo,
  setVideoHidden,
} from "../../api/adminVideos";
import { onServerEvent } from "../../api/events";
import { fetchCategories } from "../../api/videos";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { formatDuration } from "../../lib/format";
import { loadSetting, saveSetting } from "../../lib/storage";
import styles from "./Admin.module.css";
import { ClipForm } from "./ClipForm";
import { CoverForm } from "./CoverForm";
import { DetailsForm } from "./DetailsForm";
import { compatibility, qualityLabel } from "./quality";
import { VideoTable } from "./VideoTable";

export const adminPageSize = 50;

// How the list looks: "cards" with the buttons to change each video, or a
// compact "table". This browser remembers the choice.
type View = "cards" | "table";
const viewKey = "admin.videos.view";
const parseView = (data: unknown): View => (data === "table" ? "table" : "cards");

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; videos: AdminVideo[]; total: number };

const filters: { show: AdminShow; label: string }[] = [
  { show: "", label: "Tutti" },
  { show: "hidden", label: "Nascosti" },
  { show: "missing", label: "Non trovati" },
];

// VideosPage lists every video, also the hidden ones and the ones whose
// file is not found. The administrator can hide a video from everybody,
// show it again, or have its cover and previews made again.
export function VideosPage() {
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [show, setShow] = useState<AdminShow>("");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [categories, setCategories] = useState<string[]>([]);
  const [view, setView] = useState<View>(() => loadSetting(viewKey, parseView, "cards"));
  const changeView = (next: View) => {
    setView(next);
    saveSetting(viewKey, next);
  };
  const shown = useRef(adminPageSize);

  // The categories in use, offered while typing a new one.
  useEffect(() => {
    const controller = new AbortController();
    fetchCategories(controller.signal)
      .then((list) => setCategories(list.map((c) => c.name)))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, []);

  const load = useCallback(
    (limit: number, signal?: AbortSignal) => {
      fetchAdminVideos({ q, show, limit }, signal)
        .then(({ videos, total }) => setState({ kind: "ready", videos, total }))
        .catch((error: unknown) => {
          if (signal?.aborted) return;
          console.error(error);
          setState((s) => (s.kind === "ready" ? s : { kind: "error" }));
        });
    },
    [q, show],
  );

  useEffect(() => {
    const controller = new AbortController();
    shown.current = adminPageSize;
    setState({ kind: "loading" });
    load(adminPageSize, controller.signal);
    const stop = onServerEvent("library", () => load(shown.current, controller.signal));
    return () => {
      stop();
      controller.abort();
    };
  }, [load]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    setQ(query.trim());
  };
  const more = () => {
    shown.current = Math.min(shown.current + adminPageSize, 200);
    load(shown.current);
  };
  const replace = (video: AdminVideo) =>
    setState((s) =>
      s.kind === "ready"
        ? { ...s, videos: s.videos.map((v) => (v.id === video.id ? video : v)) }
        : s,
    );

  return (
    <>
      <p className={styles.lead}>
        Qui vedi tutti i video, anche quelli nascosti e quelli il cui file non si trova più. Un
        video nascosto sparisce per tutti, ma tiene mi piace, commenti e posto nelle playlist: puoi
        mostrarlo di nuovo quando vuoi.
      </p>
      <div className={styles.tools}>
        <search className={styles.searchForm}>
          <form onSubmit={search}>
            <label className={`glass ${styles.searchBox}`}>
              <Icon name="search" size={18} />
              <span className="visually-hidden">Cerca tra i video</span>
              <input
                type="search"
                placeholder="Titolo, categoria o nome del file"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </form>
        </search>
        <fieldset className={`glass ${styles.segmented}`}>
          <legend className="visually-hidden">Quali video</legend>
          {filters.map((f) => (
            <button
              key={f.show}
              type="button"
              className={styles.segment}
              aria-pressed={show === f.show}
              onClick={() => setShow(f.show)}
            >
              {f.label}
            </button>
          ))}
        </fieldset>
        <fieldset className={`glass ${styles.segmented}`}>
          <legend className="visually-hidden">Come mostrarli</legend>
          <button
            type="button"
            className={styles.segment}
            aria-pressed={view === "cards"}
            onClick={() => changeView("cards")}
          >
            Schede
          </button>
          <button
            type="button"
            className={styles.segment}
            aria-pressed={view === "table"}
            onClick={() => changeView("table")}
          >
            Tabella
          </button>
        </fieldset>
      </div>

      {state.kind === "loading" && <div className={styles.placeholder} aria-busy="true" />}
      {state.kind === "error" && (
        <EmptyState title="Video non disponibili">
          Il server non ha risposto. Ricarica la pagina tra poco.
        </EmptyState>
      )}
      {state.kind === "ready" && state.videos.length === 0 && (
        <p className={styles.lead}>Nessun video qui.</p>
      )}
      {state.kind === "ready" && state.videos.length > 0 && (
        <>
          <p className={styles.count}>{state.total.toLocaleString("it-IT")} video</p>
          <datalist id="admin-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {view === "table" ? (
            <VideoTable videos={state.videos} />
          ) : (
            <ul className={`stagger ${styles.list}`} aria-label="Video">
              {state.videos.map((video) => (
                <li key={video.id}>
                  <VideoRow video={video} onChanged={replace} />
                </li>
              ))}
            </ul>
          )}
          {state.videos.length < state.total && state.videos.length < 200 && (
            <button
              type="button"
              className={`glass ${styles.action} ${styles.more}`}
              onClick={more}
            >
              Mostra altri
            </button>
          )}
          {state.videos.length >= 200 && state.videos.length < state.total && (
            <p className={styles.lead}>Per trovare gli altri, usa la ricerca.</p>
          )}
        </>
      )}
    </>
  );
}

function VideoRow({
  video,
  onChanged,
}: {
  video: AdminVideo;
  onChanged: (video: AdminVideo) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [choosingCover, setChoosingCover] = useState(false);
  const [choosingClip, setChoosingClip] = useState(false);
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState("");

  const run = (work: () => Promise<void>, ok: string) => {
    setBusy(true);
    setProblem("");
    setDone("");
    work()
      .then(() => setDone(ok))
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non ci sono riuscito. Riprova tra poco.");
      })
      .finally(() => setBusy(false));
  };

  const quality = qualityLabel(video.height);
  const compat = compatibility(video);

  const toggle = () =>
    run(
      async () => {
        await setVideoHidden(video.id, !video.hidden);
        onChanged({ ...video, hidden: !video.hidden });
      },
      video.hidden ? "Di nuovo visibile a tutti." : "Nascosto a tutti.",
    );

  return (
    <div className={`glass ${styles.person}`}>
      <div className={styles.videoInfo}>
        <span className={styles.thumb}>
          {video.cover ? (
            <img src={video.cover} alt="" loading="lazy" decoding="async" />
          ) : (
            <Icon name="play" size={18} />
          )}
        </span>
        <div className={styles.failed}>
          <p className={styles.name}>
            {video.hidden || video.missing || video.private ? (
              video.title
            ) : (
              <Link to={`/video/${video.id}`}>{video.title}</Link>
            )}
          </p>
          {video.uploader ? (
            <p className={styles.role}>
              {video.category && `${video.category} · `}
              Caricato da {video.uploader.name}
            </p>
          ) : (
            <p
              className={`${styles.role} ${styles.path} ${styles.oneLine}`}
              title={`${video.folder}/${video.path}`}
            >
              {video.category && `${video.category} · `}
              {video.path}
            </p>
          )}
          <p className={styles.badges}>
            {video.hidden && <span className={styles.badge}>Nascosto</span>}
            {video.missing && <span className={styles.badge}>Non trovato</span>}
            {video.private && <span className={styles.badge}>Solo per chi l'ha caricato</span>}
            {video.duration === null ? (
              <span className={styles.badge}>Non ancora letto</span>
            ) : (
              <span className={styles.role}>{formatDuration(video.duration)}</span>
            )}
            {quality && <span className={styles.badgeOk}>{quality}</span>}
            {compat && (
              <span className={compat.ok ? styles.badgeOk : styles.badge}>{compat.label}</span>
            )}
            {video.duration !== null && !video.cover && (
              <span className={styles.badge}>Senza copertina</span>
            )}
            {video.coverChoice !== "" && <span className={styles.badgeOk}>Copertina scelta</span>}
            {video.clipChoice === "video" && (
              <span className={styles.badgeOk}>Anteprima caricata</span>
            )}
            {video.clipChoice === "none" && <span className={styles.badgeOk}>Senza anteprima</span>}
          </p>
          {problem && (
            <p role="alert" className={styles.problem}>
              {problem}
            </p>
          )}
          {done && (
            <p role="status" className={styles.done}>
              {done}
            </p>
          )}
        </div>
      </div>
      <div className={styles.buttons}>
        <button
          type="button"
          className={`glass ${styles.action} ${styles.small}`}
          aria-expanded={editing}
          onClick={() => {
            setDone("");
            setEditing(!editing);
          }}
        >
          Modifica
        </button>
        <button
          type="button"
          className={`glass ${styles.action} ${styles.small}`}
          aria-expanded={choosingCover}
          disabled={video.missing}
          onClick={() => {
            setDone("");
            setChoosingCover(!choosingCover);
          }}
        >
          Copertina
        </button>
        <button
          type="button"
          className={`glass ${styles.action} ${styles.small}`}
          aria-expanded={choosingClip}
          disabled={video.missing}
          onClick={() => {
            setDone("");
            setChoosingClip(!choosingClip);
          }}
        >
          Anteprima
        </button>
        <button
          type="button"
          className={`glass ${styles.action} ${styles.small}`}
          disabled={busy || video.missing}
          onClick={() =>
            run(() => refreshVideo(video.id), "In coda: copertina e anteprime arrivano tra poco.")
          }
        >
          Rifai copertina
        </button>
        <button
          type="button"
          className={`glass ${styles.action} ${styles.small}`}
          disabled={busy}
          onClick={toggle}
        >
          {video.hidden ? "Mostra" : "Nascondi"}
        </button>
      </div>
      {editing && (
        <DetailsForm
          video={video}
          onSaved={(changed) => {
            onChanged(changed);
            setEditing(false);
            setDone("Salvato. Tutti vedono titolo e categoria nuovi.");
          }}
          onCancel={() => setEditing(false)}
        />
      )}
      {choosingCover && (
        <CoverForm
          video={video}
          onChosen={(changed) => {
            onChanged(changed);
            setChoosingCover(false);
            setDone("In coda: la nuova copertina arriva tra poco.");
          }}
          onClose={() => setChoosingCover(false)}
        />
      )}
      {choosingClip && (
        <ClipForm
          video={video}
          onChosen={(changed, message) => {
            onChanged(changed);
            setChoosingClip(false);
            setDone(message);
          }}
          onClose={() => setChoosingClip(false)}
        />
      )}
    </div>
  );
}
