import { type FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  type AdminCounts,
  type AdminShow,
  type AdminVideo,
  fetchAdminVideos,
  setVideoHidden,
} from "../../api/adminVideos";
import { onServerEvent } from "../../api/events";
import type { Job } from "../../api/jobs";
import { scanLibrary } from "../../api/library";
import { Byline } from "../../components/Byline";
import { Icon } from "../../components/Icon";
import { LiveDot } from "../../components/ProgressBar";
import { formatDuration } from "../../lib/format";
import { usePresence } from "../../lib/presence";
import { richMotion } from "../../lib/richMotion";
import type { ListState } from "./AdminVideoPage";
import { useActivity } from "./activity";
import { kindShort } from "./jobText";
import { compatibility, qualityLabel } from "./quality";
import { Chip, Empty, Loading, n, PageHeader, type Tone, Unavailable, ui, useToast } from "./ui";
import videos from "./Videos.module.css";

export const adminPageSize = 50;

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; videos: AdminVideo[]; total: number };

const filters: { show: AdminShow; label: string }[] = [
  { show: "", label: "Tutti" },
  { show: "public", label: "Con link pubblico" },
  { show: "hidden", label: "Nascosti" },
  { show: "missing", label: "Non trovati" },
  { show: "short", label: "Troppo corti" },
];

const shows: readonly string[] = filters.map((f) => f.show);

// Below this width of its own room the page has no space for the table and
// the preview side by side: the videos become cards, and the preview opens
// under its card. Videos.module.css changes at the same width.
const besideFrom = 720;

// useWidth follows how wide an element really is, whatever the window.
// Unknown (null) until it can be measured.
function useWidth(): [number | null, (element: HTMLElement | null) => void] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!element) return;
    setWidth(element.getBoundingClientRect().width || null);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [width, setElement];
}

// pressedOnSomething says the click was on a link or a button of the row, or
// ended a selection of its text: it is not a click on the row.
function pressedOnSomething(event: MouseEvent): boolean {
  if ((event.target as HTMLElement).closest("a, button")) return true;
  return (window.getSelection()?.toString() ?? "") !== "";
}

// VideosPage lists every video, also the hidden ones and the ones whose
// file is not found, in a table: picture, length, folder, category,
// author and state. A click on a row shows its preview beside the table,
// another click closes it; with little room the videos are cards and the
// preview opens under its card. The title and the picture open the video's
// own page, where it is changed.
export function VideosPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const asked = params.get("show") ?? "";
  const show = (shows.includes(asked) ? asked : "") as AdminShow;
  const [query, setQuery] = useState(q);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [counts, setCounts] = useState<AdminCounts | undefined>(undefined);
  const [chosen, setChosen] = useState<number | null>(null);
  const shown = useRef(adminPageSize);
  const [stageWidth, setStage] = useWidth();
  const stage = useRef<HTMLDivElement | null>(null);
  const keep = useRef<{ element: HTMLElement; top: number } | null>(null);
  const { jobs } = useActivity();
  const [toast, say] = useToast();
  const [scanning, setScanning] = useState(false);

  const load = useCallback(
    (limit: number, signal?: AbortSignal) => {
      fetchAdminVideos({ q, show, limit }, signal)
        .then(({ videos: list, total, counts: c }) => {
          setState({ kind: "ready", videos: list, total });
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

  const change = (next: { q?: string; show?: AdminShow }) => {
    const p = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value) p.set(key, value);
      else p.delete(key);
    }
    setParams(p, { replace: true });
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    change({ q: query.trim() });
  };
  const more = () => {
    shown.current = Math.min(shown.current + adminPageSize, 200);
    load(shown.current);
  };
  const scan = () => {
    setScanning(true);
    scanLibrary()
      .then(() => say("Controllo le cartelle: i video nuovi arrivano tra poco."))
      .catch(() => say("Il controllo non è partito. Riprova tra poco.", true))
      .finally(() => setScanning(false));
  };

  const list = state.kind === "ready" ? state.videos : [];
  const ids = list.map((v) => v.id);
  const selected = list.find((v) => v.id === chosen) ?? null;
  const preview = usePresence<AdminVideo>(selected);
  const beside = stageWidth === null || stageWidth >= besideFrom;
  const running = jobs?.running ?? null;

  // A card whose preview opens stays where the finger left it, even when
  // the preview of a card above it closes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: after every new choice
  useLayoutEffect(() => {
    const kept = keep.current;
    keep.current = null;
    if (kept) window.scrollBy(0, kept.element.getBoundingClientRect().top - kept.top);
  }, [chosen]);

  const toggle = (id: number, element?: HTMLElement) => {
    if (element && !beside) keep.current = { element, top: element.getBoundingClientRect().top };
    setChosen((now) => (now === id ? null : id));
  };

  // Closing with the X or Esc gives the keyboard back to the button of the row.
  const close = useCallback(() => {
    setChosen(null);
    const buttons = stage.current?.querySelectorAll<HTMLElement>(`[data-toggle="${chosen}"]`);
    const found = [...(buttons ?? [])];
    (found.find((b) => b.offsetParent !== null) ?? found[0])?.focus();
  }, [chosen]);

  const isOpen = selected !== null;
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Esc in a field belongs to the field, and in a window to the window.
      const target = event.target as HTMLElement;
      if (target.closest?.("input, textarea, select, dialog")) return;
      if (document.querySelector("dialog[open]")) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  const inspector = (video: AdminVideo, inline: boolean) => (
    <div
      ref={preview.ref}
      className={videos.previewBox}
      data-inline={inline || undefined}
      data-leaving={preview.leaving || undefined}
      onAnimationEnd={(event) => {
        if (inline && !preview.leaving && event.target === event.currentTarget) {
          event.currentTarget.scrollIntoView?.({
            block: "nearest",
            behavior: richMotion() ? "smooth" : "auto",
          });
        }
      }}
    >
      <Inspector
        video={video}
        ids={ids}
        inline={inline}
        job={running?.videoId === video.id ? running : null}
        onClose={close}
        onChanged={(hidden) => {
          say(hidden ? "Video nascosto a tutti." : "Video di nuovo visibile.");
          load(shown.current);
        }}
        onFailed={() => say("Non è stato possibile. Riprova tra poco.", true)}
      />
    </div>
  );

  return (
    <>
      <PageHeader
        title="Video"
        description={
          counts?.[""] !== undefined
            ? `${n(counts[""])} video dalle cartelle e dai caricamenti. Scegli un video per l'anteprima, il suo titolo per cambiarlo.`
            : "Tutti i video, anche nascosti o non trovati. Scegli un video per l'anteprima, il suo titolo per cambiarlo."
        }
        actions={
          <>
            <button type="button" className={ui.btn} disabled={scanning} onClick={scan}>
              <Icon name="refresh" size={18} />
              Controlla le cartelle
            </button>
            <Link to="/carica" className={`${ui.btn} ${ui.primary}`}>
              <Icon name="upload" size={18} />
              Carica un video
            </Link>
          </>
        }
      />

      <div className={ui.toolbar}>
        <search className={ui.search}>
          <form onSubmit={search}>
            <label className={ui.searchBox}>
              <Icon name="search" size={18} />
              <span className="visually-hidden">Cerca tra i video</span>
              <input
                type="search"
                placeholder="Titolo, categoria o nome del file"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (e.target.value === "" && q !== "") change({ q: "" });
                }}
              />
            </label>
          </form>
        </search>
      </div>

      <fieldset className={ui.filters}>
        <legend className="visually-hidden">Mostra</legend>
        {filters.map((f) => (
          <button
            key={f.show}
            type="button"
            className={ui.filter}
            aria-pressed={show === f.show}
            onClick={() => change({ show: f.show })}
          >
            {f.label}
            {counts?.[f.show] !== undefined && <b>{n(counts[f.show] ?? 0)}</b>}
          </button>
        ))}
      </fieldset>

      {state.kind === "loading" && <Loading />}
      {state.kind === "error" && <Unavailable title="Video non disponibili" />}
      {state.kind === "ready" && list.length === 0 && (
        <Empty
          icon="film"
          title={q ? "Nessun video con queste parole" : "Nessun video qui"}
          action={
            q || show ? (
              <button
                type="button"
                className={ui.btn}
                onClick={() => {
                  setQuery("");
                  change({ q: "", show: "" });
                }}
              >
                Mostra tutti i video
              </button>
            ) : (
              <Link to="/admin/cartelle" className={`${ui.btn} ${ui.primary}`}>
                Scegli le cartelle dei video
              </Link>
            )
          }
        >
          {q || show
            ? "Prova un'altra ricerca, o togli il filtro."
            : "Aggiungi una cartella con dei video, o caricane uno."}
        </Empty>
      )}
      {state.kind === "ready" && list.length > 0 && (
        <div
          ref={(element) => {
            stage.current = element;
            setStage(element);
          }}
          className={videos.stage}
        >
          <div className={videos.layout}>
            <div className={videos.listSide}>
              <div className={`${ui.tableWrap} ${videos.tableBox}`}>
                <table className={`${ui.table} ${videos.table}`} aria-label="Video">
                  <thead>
                    <tr>
                      <th scope="col">Video</th>
                      <th scope="col" data-col="duration">
                        Durata
                      </th>
                      <th scope="col" data-col="folder">
                        Cartella
                      </th>
                      <th scope="col" data-col="category">
                        Categoria
                      </th>
                      <th scope="col" data-col="author">
                        Autore
                      </th>
                      <th scope="col" data-col="state">
                        Stato
                      </th>
                      <th scope="col" data-col="actions">
                        <span className="visually-hidden">Azioni</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((video) => (
                      <VideoRow
                        key={video.id}
                        video={video}
                        ids={ids}
                        job={running?.videoId === video.id ? running : null}
                        selected={selected?.id === video.id}
                        onToggle={() => toggle(video.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className={videos.cards} aria-label="Video">
                {list.map((video) => (
                  <li key={video.id}>
                    <VideoCard
                      video={video}
                      ids={ids}
                      job={running?.videoId === video.id ? running : null}
                      selected={selected?.id === video.id}
                      onToggle={(element) => toggle(video.id, element)}
                    />
                    {!beside && preview.shown?.id === video.id && inspector(preview.shown, true)}
                  </li>
                ))}
              </ul>

              {list.length < state.total && list.length < 200 && (
                <button type="button" className={`${ui.btn} ${videos.more}`} onClick={more}>
                  Mostra altri ({n(state.total - list.length)})
                </button>
              )}
              {list.length >= 200 && list.length < state.total && (
                <p className={ui.cardText}>Per trovare gli altri, usa la ricerca.</p>
              )}
            </div>
            <div className={videos.previewSlot} data-open={(beside && isOpen) || undefined}>
              {beside && preview.shown && inspector(preview.shown, false)}
            </div>
          </div>
        </div>
      )}
      {toast}
    </>
  );
}

// videoState is the one state worth seeing first: a problem, the work
// going on, who sees it, or "Pronto".
function videoState(video: AdminVideo, job: Job | null): { label: string; tone: Tone } {
  if (job) return { label: `${kindShort[job.kind]} in corso`, tone: "live" };
  if (video.missing) return { label: "File non trovato", tone: "bad" };
  if (video.hidden) return { label: "Nascosto", tone: "warn" };
  if (video.tooShort) return { label: "Troppo corto", tone: "warn" };
  if (video.duration === null) return { label: "Da leggere", tone: "info" };
  if (video.private) return { label: "Privato", tone: "info" };
  const c = compatibility(video);
  if (c && !c.ok) return { label: "Da convertire", tone: "warn" };
  if (video.publicLink !== null) return { label: "Link pubblico", tone: "info" };
  return { label: "Pronto", tone: "ok" };
}

function StateChip({ video, job }: { video: AdminVideo; job: Job | null }) {
  const s = videoState(video, job);
  return (
    <Chip
      tone={s.tone}
      icon={s.tone === "live" ? <LiveDot /> : s.tone === "ok" ? "check" : undefined}
    >
      {s.label}
    </Chip>
  );
}

// folderName is the folder a video is in, as the eye knows it: the
// first folder of its path inside the video folder, or the folder itself.
function folderName(video: AdminVideo): string {
  const inside = video.path.split("/").filter(Boolean);
  if (inside.length > 1) return inside[0] ?? "";
  const parts = video.folder.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? video.folder;
}

// fileName is the last part of the path of a video: the whole of it is long,
// and it is in the preview.
function fileName(video: AdminVideo): string {
  return video.path.split("/").pop() ?? video.path;
}

function Thumb({ video, working }: { video: AdminVideo; working: boolean }) {
  return (
    <span className={`${ui.thumb} ${videos.thumb}`} data-working={working || undefined}>
      {video.cover ? (
        <img src={video.cover} alt="" loading="lazy" decoding="async" />
      ) : (
        <Icon name="film" size={20} />
      )}
      {video.duration !== null && (
        <span className={ui.duration}>{formatDuration(video.duration)}</span>
      )}
    </span>
  );
}

// CoverLink is the picture of a video as a link to its page.
function CoverLink({ video, ids, job }: { video: AdminVideo; ids: number[]; job: Job | null }) {
  return (
    <Link
      to={`/admin/video/${video.id}`}
      state={{ ids } satisfies ListState}
      className={videos.coverLink}
      aria-label={`Copertina di ${video.title}`}
    >
      <Thumb video={video} working={job !== null} />
    </Link>
  );
}

// ToggleButton opens and closes the preview of a video from the keyboard;
// the mouse and the finger can use the whole row or card too.
function ToggleButton({
  video,
  selected,
  onToggle,
}: {
  video: AdminVideo;
  selected: boolean;
  onToggle: (element: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      className={videos.toggle}
      data-toggle={video.id}
      aria-expanded={selected}
      aria-label={`Anteprima di ${video.title}`}
      onClick={(event) => {
        const box = event.currentTarget.closest<HTMLElement>("[data-card]");
        onToggle(box ?? event.currentTarget);
      }}
    >
      <Icon name="chevronDown" size={18} />
    </button>
  );
}

function VideoRow({
  video,
  ids,
  job,
  selected,
  onToggle,
}: {
  video: AdminVideo;
  ids: number[];
  job: Job | null;
  selected: boolean;
  onToggle: () => void;
}) {
  const page = `/admin/video/${video.id}`;
  const folder = folderName(video);
  return (
    <tr
      data-selected={selected || undefined}
      data-working={job ? true : undefined}
      onClick={(event) => {
        if (!pressedOnSomething(event.nativeEvent)) onToggle();
      }}
      className={videos.pickable}
    >
      <td>
        <div className={videos.videoCell}>
          <CoverLink video={video} ids={ids} job={job} />
          <div className={videos.videoText}>
            <Link to={page} state={{ ids } satisfies ListState} className={videos.title}>
              {video.title}
            </Link>
            <span className={videos.path} title={video.path}>
              {fileName(video)}
            </span>
          </div>
        </div>
      </td>
      <td className={videos.num} data-col="duration">
        {video.duration === null ? "—" : formatDuration(video.duration)}
      </td>
      <td data-col="folder">
        <span className={videos.clamp} title={folder}>
          {folder}
        </span>
      </td>
      <td data-col="category">
        {video.category ? (
          <span className={videos.clamp} title={video.category}>
            {video.category}
          </span>
        ) : (
          <span className={videos.none}>Nessuna</span>
        )}
      </td>
      <td data-col="author">
        <span className={videos.author} title={video.owner?.name}>
          <Byline owner={video.owner} size={26} nameClass={videos.authorName} />
        </span>
      </td>
      <td data-col="state">
        <StateChip video={video} job={job} />
      </td>
      <td className={videos.actions} data-col="actions">
        <span className={videos.actionsRow}>
          <Link
            to={page}
            state={{ ids } satisfies ListState}
            className={`${ui.btn} ${ui.small} ${videos.edit}`}
            aria-label={`Modifica ${video.title}`}
          >
            Modifica
          </Link>
          <ToggleButton video={video} selected={selected} onToggle={onToggle} />
        </span>
      </td>
    </tr>
  );
}

// VideoCard is a video where there is no room for the table: the picture
// and the title open its page, the rest of the card opens its preview.
function VideoCard({
  video,
  ids,
  job,
  selected,
  onToggle,
}: {
  video: AdminVideo;
  ids: number[];
  job: Job | null;
  selected: boolean;
  onToggle: (element: HTMLElement) => void;
}) {
  const meta = [...new Set([folderName(video), video.category, qualityLabel(video.height)])].filter(
    Boolean,
  );
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the button inside is the way in for the keyboard
    // biome-ignore lint/a11y/useKeyWithClickEvents: the button inside is the way in for the keyboard
    <div
      className={videos.card}
      data-card
      data-selected={selected || undefined}
      onClick={(event) => {
        if (!pressedOnSomething(event.nativeEvent)) onToggle(event.currentTarget);
      }}
    >
      <CoverLink video={video} ids={ids} job={job} />
      <span className={videos.cardText}>
        <Link
          to={`/admin/video/${video.id}`}
          state={{ ids } satisfies ListState}
          className={videos.cardTitle}
        >
          {video.title}
        </Link>
        <span>{meta.join(" · ")}</span>
        <span className={videos.cardFoot}>
          <span className={videos.author}>
            <Byline owner={video.owner} size={20} nameClass={videos.authorName} />
          </span>
          <StateChip video={video} job={job} />
        </span>
      </span>
      <ToggleButton video={video} selected={selected} onToggle={onToggle} />
    </div>
  );
}

// Inspector is the preview of the chosen video: its picture, where it is,
// what it is made of, and the main buttons. Beside the table it shows the
// picture and the title too; under a card, which has them, it does not.
function Inspector({
  video,
  ids,
  inline,
  job,
  onClose,
  onChanged,
  onFailed,
}: {
  video: AdminVideo;
  ids: number[];
  inline: boolean;
  job: Job | null;
  onClose: () => void;
  onChanged: (hidden: boolean) => void;
  onFailed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const c = compatibility(video);
  const format = [video.format, video.videoCodec.toUpperCase(), qualityLabel(video.height)]
    .filter(Boolean)
    .join(" · ");
  return (
    <aside
      className={videos.inspector}
      data-inline={inline || undefined}
      aria-label={`Dettagli di ${video.title}`}
    >
      <div className={videos.inspHead}>
        <h2 className={inline ? "visually-hidden" : videos.inspTitle}>{video.title}</h2>
        <button
          type="button"
          className={videos.close}
          aria-label="Chiudi anteprima"
          onClick={onClose}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      {!inline && <CoverLink video={video} ids={ids} job={job} />}
      <p className={videos.path}>
        {video.folder}/{video.path}
      </p>
      <div className={ui.chips}>
        <StateChip video={video} job={job} />
        {c && (
          <Chip tone={c.ok ? "ok" : "warn"} icon={c.ok ? "check" : "alert"}>
            {c.label}
          </Chip>
        )}
      </div>
      <dl className={ui.kv}>
        <dt>Durata</dt>
        <dd>{video.duration === null ? "—" : formatDuration(video.duration)}</dd>
        <dt>Autore</dt>
        <dd>
          <span className={videos.author} data-end>
            <Byline owner={video.owner} size={22} nameClass={videos.authorName} />
          </span>
        </dd>
        <dt>Cartella</dt>
        <dd>{folderName(video)}</dd>
        <dt>Categoria</dt>
        <dd>{video.category || "Nessuna"}</dd>
        {format && (
          <>
            <dt>Formato</dt>
            <dd>{format}</dd>
          </>
        )}
        <dt>Aggiunto</dt>
        <dd>{video.addedAt.toLocaleDateString("it-IT")}</dd>
        <dt>Mi piace</dt>
        <dd>{n(video.likes)}</dd>
      </dl>
      <div className={videos.inspActions}>
        <Link
          to={`/admin/video/${video.id}`}
          state={{ ids } satisfies ListState}
          className={`${ui.btn} ${ui.primary}`}
        >
          <Icon name="edit" size={16} />
          Modifica
        </Link>
        <Link to={`/video/${video.id}`} className={ui.btn}>
          Apri pagina
        </Link>
        <button
          type="button"
          className={ui.btn}
          disabled={busy || video.missing}
          onClick={() => {
            setBusy(true);
            setVideoHidden(video.id, !video.hidden)
              .then(() => onChanged(!video.hidden))
              .catch(onFailed)
              .finally(() => setBusy(false));
          }}
        >
          <Icon name={video.hidden ? "eye" : "lock"} size={16} />
          {video.hidden ? "Mostra" : "Nascondi"}
        </button>
      </div>
    </aside>
  );
}
