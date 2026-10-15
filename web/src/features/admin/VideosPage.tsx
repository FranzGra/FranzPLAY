import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { type AdminShow, type AdminVideo, fetchAdminVideos } from "../../api/adminVideos";
import { onServerEvent } from "../../api/events";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { formatDuration } from "../../lib/format";
import { loadSetting, saveSetting } from "../../lib/storage";
import styles from "./Admin.module.css";
import { qualityLabel } from "./quality";
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
  { show: "public", label: "Pubblici" },
  { show: "hidden", label: "Nascosti" },
  { show: "missing", label: "Non trovati" },
  { show: "short", label: "Troppo corti" },
];

// VideosPage lists every video, also the hidden ones and the ones whose
// file is not found. Each opens its own page (AdminVideoPage), where the
// administrator changes it.
export function VideosPage() {
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [show, setShow] = useState<AdminShow>("");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [view, setView] = useState<View>(() => loadSetting(viewKey, parseView, "cards"));
  const changeView = (next: View) => {
    setView(next);
    saveSetting(viewKey, next);
  };
  const shown = useRef(adminPageSize);

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

  return (
    <>
      <p className={styles.lead}>
        Qui vedi tutti i video, anche quelli nascosti e quelli il cui file non si trova più. Apri un
        video per cambiarne titolo, copertina, chi lo vede e il link pubblico.
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
          {view === "table" ? (
            <VideoTable videos={state.videos} />
          ) : (
            <ul className={`stagger ${styles.list}`} aria-label="Video">
              {state.videos.map((video) => (
                <li key={video.id}>
                  <VideoRow video={video} />
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

// VideoRow is one video in the list, light: its picture, title, a line
// about it and at most two states. The whole row opens its page, where
// everything about the video is changed; "Modifica" says so.
function VideoRow({ video }: { video: AdminVideo }) {
  const meta = [
    video.uploader ? `Caricato da ${video.uploader.name}` : video.category,
    video.duration === null ? "" : formatDuration(video.duration),
    qualityLabel(video.height),
  ].filter(Boolean);
  const states = rowStates(video).slice(0, 2);
  const page = `/admin/video/${video.id}`;
  return (
    <div className={`glass ${styles.videoRow}`}>
      <span className={styles.thumb}>
        {video.cover ? (
          <img src={video.cover} alt="" loading="lazy" decoding="async" />
        ) : (
          <Icon name="play" size={18} />
        )}
      </span>
      <div className={styles.videoRowText}>
        <p className={styles.name}>
          <Link to={page} className={styles.rowLink}>
            {video.title}
          </Link>
        </p>
        <p className={`${styles.role} ${styles.oneLine}`}>{meta.join(" · ") || video.path}</p>
        {states.length > 0 && (
          <p className={styles.badges}>
            {states.map((s) => (
              <span key={s.label} className={styles.softBadge}>
                {s.icon && <Icon name={s.icon} size={13} />}
                {s.label}
              </span>
            ))}
          </p>
        )}
      </div>
      <Link
        to={page}
        className={`glass ${styles.action} ${styles.small} ${styles.rowEdit}`}
        aria-label={`Modifica ${video.title}`}
      >
        Modifica
      </Link>
    </div>
  );
}

// rowStates are the states worth seeing in the list, the most urgent
// first: problems, then who sees it.
function rowStates(video: AdminVideo): { label: string; icon?: "globe" | "lock" }[] {
  const out: { label: string; icon?: "globe" | "lock" }[] = [];
  if (video.missing) out.push({ label: "Non trovato" });
  if (video.hidden) out.push({ label: "Nascosto" });
  if (video.tooShort) out.push({ label: "Troppo corto" });
  if (video.duration === null) out.push({ label: "Non ancora letto" });
  if (video.publicLink !== null) out.push({ label: "Pubblico", icon: "globe" });
  if (video.private) out.push({ label: "Solo per chi l'ha caricato", icon: "lock" });
  return out;
}
