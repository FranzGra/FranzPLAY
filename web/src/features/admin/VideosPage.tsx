import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  type AdminCounts,
  type AdminShow,
  type AdminVideo,
  fetchAdminVideos,
} from "../../api/adminVideos";
import { onServerEvent } from "../../api/events";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { formatDuration } from "../../lib/format";
import { loadSetting, saveSetting } from "../../lib/storage";
import styles from "./Admin.module.css";
import type { ListState } from "./AdminVideoPage";
import { FilterMenu } from "./FilterMenu";
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
  // How many videos each filter shows, from the same answer as the list.
  const [counts, setCounts] = useState<AdminCounts | undefined>(undefined);
  const [view, setView] = useState<View>(() => loadSetting(viewKey, parseView, "cards"));
  const changeView = (next: View) => {
    setView(next);
    saveSetting(viewKey, next);
  };
  const shown = useRef(adminPageSize);

  const load = useCallback(
    (limit: number, signal?: AbortSignal) => {
      fetchAdminVideos({ q, show, limit }, signal)
        .then(({ videos, total, counts: c }) => {
          setState({ kind: "ready", videos, total });
          setCounts(c);
        })
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
      <p className={styles.leadShort}>
        Tutti i video, anche nascosti o non trovati. Aprine uno per cambiarlo.
      </p>
      <div className={styles.toolbar}>
        <search className={styles.toolbarSearch}>
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
        <div className={styles.toolbarSide}>
          <FilterMenu
            options={filters.map((f) => ({
              value: f.show,
              label: f.label,
              count: counts?.[f.show],
            }))}
            value={show}
            onChange={setShow}
          />
          <fieldset className={`glass ${styles.viewSwitch}`}>
            <legend className="visually-hidden">Come mostrarli</legend>
            <button
              type="button"
              className={styles.viewButton}
              aria-pressed={view === "cards"}
              aria-label="Schede"
              title="Schede"
              onClick={() => changeView("cards")}
            >
              <Icon name="categories" size={18} />
            </button>
            <button
              type="button"
              className={styles.viewButton}
              aria-pressed={view === "table"}
              aria-label="Tabella"
              title="Tabella"
              onClick={() => changeView("table")}
            >
              <Icon name="menu" size={18} />
            </button>
          </fieldset>
          {state.kind === "ready" && (
            <span className={styles.toolbarCount}>{state.total.toLocaleString("it-IT")} video</span>
          )}
        </div>
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
          {view === "table" ? (
            <VideoTable videos={state.videos} />
          ) : (
            <ul className={`stagger ${styles.list}`} aria-label="Video">
              {state.videos.map((video) => (
                <li key={video.id}>
                  <VideoRow video={video} ids={state.videos.map((v) => v.id)} />
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
function VideoRow({ video, ids }: { video: AdminVideo; ids: number[] }) {
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
          <Link to={page} state={{ ids } satisfies ListState} className={styles.rowLink}>
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
        state={{ ids } satisfies ListState}
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
