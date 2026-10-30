import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  askSubtitles,
  askTranslation,
  deleteMadeSubtitles,
  fetchSubtitledVideos,
  fetchSubtitlesSetup,
  fromLanguage,
  languageName,
  type SubtitledVideo,
  type SubtitleRequest,
  type SubtitlesHave,
  type SubtitlesSetup,
  type SubtitleTranslation,
  spokenUnknown,
  takeBackSubtitles,
  takeBackTranslation,
  type VideoSubtitle,
} from "../../api/autosubs";
import { onServerEvent } from "../../api/events";
import { remainingSeconds } from "../../api/jobs";
import { Icon } from "../../components/Icon";
import { BusyRing, ProgressBar } from "../../components/ProgressBar";
import { Select } from "../../components/Select";
import { formatRemaining } from "../../lib/format";
import { pollEvery, throttle } from "./activity";
import { downloadedText, heardText, translatedText } from "./jobText";
import subs from "./Subtitles.module.css";
import { TranscribeForm, TranslateForm } from "./SubtitlesForms";
import { SubtitlesSetupBox } from "./SubtitlesSetup";
import { Chip, Empty, Loading, n, PageHeader, Unavailable, ui } from "./ui";

const pageSize = 50;

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; setup: SubtitlesSetup; videos: SubtitledVideo[]; total: number };

const filters: { have: SubtitlesHave; label: string }[] = [
  { have: "", label: "Tutti" },
  { have: "with", label: "Con sottotitoli" },
  { have: "without", label: "Senza sottotitoli" },
];

// SubtitlesPage shows which videos have subtitles, and lets the
// administrator ask for two different things: whisper listens to a video and
// writes what it hears, in the language spoken; a translator turns subtitles
// already written into other languages. On top, one line for whisper's models
// and one for the translator; the video being worked on now is lit up in the
// list, with a bar that moves.
export function SubtitlesPage() {
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [have, setHave] = useState<SubtitlesHave>("");
  const [lang, setLang] = useState("");
  const [state, setState] = useState<State>({ kind: "loading" });
  const shown = useRef(pageSize);
  const follow = useRef<() => void>(() => {});

  const load = useCallback(
    (limit: number, signal?: AbortSignal) => {
      return Promise.all([
        fetchSubtitlesSetup(signal),
        fetchSubtitledVideos({ q, have, lang, limit }, signal),
      ])
        .then(([setup, { videos, total }]) => setState({ kind: "ready", setup, videos, total }))
        .catch((error: unknown) => {
          if (signal?.aborted) return;
          console.error(error);
          setState((s) => (s.kind === "ready" ? s : { kind: "error" }));
        });
    },
    [q, have, lang],
  );

  useEffect(() => {
    const controller = new AbortController();
    shown.current = pageSize;
    setState({ kind: "loading" });
    // The work moves on in the queue: follow it. The list is long, so it
    // is asked again at most once a second, however fast the bars move, and
    // never before the last answer came.
    let busy = true;
    let more = false;
    const settled = () => {
      busy = false;
      if (more) {
        more = false;
        again.call();
      }
    };
    const again = throttle(() => {
      if (busy) {
        more = true;
        return;
      }
      busy = true;
      load(shown.current, controller.signal).finally(settled);
    }, 1000);
    follow.current = again.call;
    load(pageSize, controller.signal).finally(settled);
    const stop = onServerEvent("jobs", again.call);
    return () => {
      stop();
      again.cancel();
      follow.current = () => {};
      controller.abort();
    };
  }, [load]);

  // A download says how it goes only when asked: ask often while it runs.
  const downloading =
    state.kind === "ready" && !!state.setup.download && !state.setup.download.ended;
  useEffect(() => {
    if (!downloading) return;
    const timer = window.setInterval(() => follow.current(), pollEvery);
    return () => window.clearInterval(timer);
  }, [downloading]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    setQ(query.trim());
  };
  const more = () => {
    shown.current = Math.min(shown.current + pageSize, 200);
    load(shown.current);
  };
  const reload = () => load(shown.current);

  return (
    <>
      <PageHeader
        title="Sottotitoli"
        description="Due lavori distinti. Trascrivi: Whisper ascolta il video e scrive ciò che sente, nella lingua in cui si parla. Su un computer piccolo un film può richiedere ore. Traduci: dai sottotitoli già scritti crea altre lingue, senza riascoltare e in molto meno tempo."
      />
      {state.kind === "ready" && <SubtitlesSetupBox setup={state.setup} onChanged={reload} />}

      <div className={`${ui.toolbar} ${subs.tools}`}>
        <search className={ui.search}>
          <form onSubmit={search}>
            <label className={ui.searchBox}>
              <Icon name="search" size={18} />
              <span className="visually-hidden">Cerca tra i video</span>
              <input
                type="search"
                placeholder="Titolo del video"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </form>
        </search>
        <fieldset className={ui.filters}>
          <legend className="visually-hidden">Quali video</legend>
          {filters.map((f) => (
            <button
              key={f.have}
              type="button"
              className={ui.filter}
              aria-pressed={have === f.have}
              onClick={() => setHave(f.have)}
            >
              {f.label}
            </button>
          ))}
        </fieldset>
        <Select
          aria-label="Lingua dei sottotitoli"
          value={lang}
          options={[
            { value: "", label: "Tutte le lingue" },
            ...(state.kind === "ready" ? state.setup.languages : []).map((l) => ({
              value: l,
              label: languageName(l),
            })),
          ]}
          onChange={setLang}
        />
      </div>

      {state.kind === "loading" && <Loading />}
      {state.kind === "error" && <Unavailable title="Sottotitoli non disponibili" />}
      {state.kind === "ready" && state.videos.length === 0 && (
        <Empty icon="subtitles" title="Nessun video qui">
          Prova un'altra ricerca, o togli il filtro.
        </Empty>
      )}
      {state.kind === "ready" && state.videos.length > 0 && (
        <>
          <p className={subs.count}>{n(state.total)} video</p>
          <ul className={subs.list} aria-label="Video">
            {state.videos.map((video) => (
              <li key={video.id}>
                <VideoRow video={video} setup={state.setup} onChanged={reload} />
              </li>
            ))}
          </ul>
          {state.videos.length < state.total && state.videos.length < 200 && (
            <button type="button" className={`${ui.btn} ${subs.more}`} onClick={more}>
              Mostra altri ({n(state.total - state.videos.length)})
            </button>
          )}
          {state.videos.length >= 200 && state.videos.length < state.total && (
            <p className={ui.cardText}>Per trovare gli altri, usa la ricerca.</p>
          )}
        </>
      )}
    </>
  );
}

// sourceNames say where subtitles not made here come from.
const sourceNames: Record<VideoSubtitle["source"], string> = {
  file: "file accanto",
  inside: "nel video",
  auto: "originale",
};

// lowerNames writes languages in the middle of a sentence: "inglese, tedesco".
function lowerNames(langs: string[]): string {
  return langs.map((l) => languageName(l).toLowerCase()).join(", ");
}

// requestText says how the listening to a video goes.
function requestText(r: SubtitleRequest): string {
  if (r.state === "failed") return "Trascrizione non riuscita";
  if (r.state === "pending") return "Trascrizione in coda";
  switch (r.stage) {
    case "audio":
      return "Prendo l'audio dal video";
    case "transcribe":
      return "Whisper sta ascoltando";
    default:
      return "Trascrizione al lavoro";
  }
}

// requestDetails says what was asked of whisper.
function requestDetails(r: SubtitleRequest): string {
  const spoken = r.spoken
    ? `lingua ${languageName(r.spoken).toLowerCase()}`
    : "lingua riconosciuta da Whisper";
  const after = r.translate.length > 0 ? `, poi traduzione in ${lowerNames(r.translate)}` : "";
  return `modello ${r.model}, ${spoken}${after}`;
}

// Listened says how far whisper is in a video: "38% · 12:05 di 32:40
// ascoltati · restano circa 9 min".
function Listened({ r }: { r: SubtitleRequest }) {
  const heard = heardText(r.heardSeconds, r.totalSeconds);
  const ran = r.startedAt ? Math.max(0, (Date.now() - r.startedAt.getTime()) / 1000) : null;
  const left = remainingSeconds({ seconds: ran, progress: r.progress });
  if (r.progress === null && !heard) return null;
  return (
    <p className={subs.listened}>
      {r.progress !== null && <b>{Math.floor(r.progress)}%</b>}
      {heard && <span>{heard}</span>}
      {left !== null && r.progress !== null && r.progress < 100 && (
        <span>restano {formatRemaining(left)}</span>
      )}
    </p>
  );
}

// Steps are the steps of whisper's work on a video: done, now, next. The
// translation comes after, as a job of its own.
function Steps({ r }: { r: SubtitleRequest }) {
  const order = ["audio", "transcribe"] as const;
  const at = r.stage === "transcribe" ? 1 : 0;
  const steps = [
    { id: order[0], label: "Audio estratto", now: "Prendo l'audio" },
    { id: order[1], label: "Ascoltato", now: `Whisper ascolta · ${r.model}` },
  ];
  return (
    <ol className={ui.steps} aria-label="Come va">
      {steps.map((s, i) => {
        const state = i < at ? "done" : i === at ? "now" : "next";
        return (
          <li key={s.id} data-step={state}>
            {state === "done" && <Icon name="check" size={13} />}
            {state === "now" && <BusyRing size={13} />}
            {state === "done" ? s.label : s.now}
          </li>
        );
      })}
      {r.translate.length > 0 && <li data-step="next">Poi traduco in {lowerNames(r.translate)}</li>}
    </ol>
  );
}

// translationProblem says in words why a translation stopped, for the errors
// we know; the others are shown as they are.
function translationProblem(error: string, setup: SubtitlesSetup): string {
  if (error.includes("the translator is off")) {
    return setup.translatorHelp.off || "Il traduttore non è attivo.";
  }
  if (error.includes("translation refused")) {
    return "Il traduttore ha rifiutato il lavoro: controlla che conosca queste lingue.";
  }
  if (error.includes("translation model")) {
    return "Non sono riuscito a scaricare il modello che serve per tradurre. Controlla che il server arrivi a Internet e riprova.";
  }
  if (error.includes("not there any more")) {
    return "I sottotitoli da tradurre non ci sono più. Scegli di nuovo da cosa partire.";
  }
  return error;
}

// Translating says how a translation asked goes.
function Translating({
  t,
  title,
  setup,
}: {
  t: SubtitleTranslation;
  title: string;
  setup: SubtitlesSetup;
}) {
  const what = `Traduzione in ${lowerNames(t.to)} ${fromLanguage(t.from)}`;
  if (t.state === "running") {
    const downloading = t.stage === "model";
    const count = downloading ? downloadedText(t.done, t.total) : translatedText(t.done, t.total);
    const ran = t.startedAt ? Math.max(0, (Date.now() - t.startedAt.getTime()) / 1000) : null;
    const left = remainingSeconds({ seconds: ran, progress: t.progress });
    return (
      <div className={subs.work}>
        <p className={subs.status} role="status">
          <BusyRing size={16} />
          <span>{downloading ? `${what}: scarico il modello, solo la prima volta` : what}</span>
        </p>
        <ProgressBar percent={t.progress} label={`Traduzione di ${title}`} />
        {(t.progress !== null || count) && (
          <p className={subs.listened}>
            {t.progress !== null && <b>{Math.floor(t.progress)}%</b>}
            {count && <span>{count}</span>}
            {left !== null && t.progress !== null && t.progress > 0 && t.progress < 100 && (
              <span>restano {formatRemaining(left)}</span>
            )}
          </p>
        )}
      </div>
    );
  }
  if (t.state === "failed") {
    return (
      <div className={subs.work}>
        <p className={subs.status} role="status">
          <span>{what}: non riuscita.</span>
        </p>
        {t.error && (
          <p className={subs.error} title={t.error}>
            {translationProblem(t.error, setup)}
          </p>
        )}
      </div>
    );
  }
  return (
    <p className={subs.status} role="status">
      <Chip tone="info" icon="clock">
        In coda
      </Chip>
      <span>
        {what}:{" "}
        {t.error
          ? "si è interrotta, riprovo da solo tra poco."
          : "parte appena finiscono i lavori in corso."}
      </span>
    </p>
  );
}

// Tracks shows what a video has, in groups: what whisper heard, what was
// already there, and the translations with what they come from.
function Tracks({
  video,
  busy,
  onDelete,
}: {
  video: SubtitledVideo;
  busy: boolean;
  onDelete: (lang: string) => void;
}) {
  const groups = [
    {
      name: "Originale",
      items: video.subtitles.filter((s) => s.source === "auto" && !s.from),
    },
    {
      name: "Già presenti",
      items: video.subtitles.filter((s) => s.source !== "auto"),
    },
    {
      name: "Tradotti",
      items: video.subtitles.filter((s) => s.source === "auto" && s.from),
    },
  ].filter((g) => g.items.length > 0);
  if (groups.length === 0) return <span className={subs.none}>Nessun sottotitolo</span>;
  return (
    <div className={subs.tracks}>
      {groups.map((g) => (
        <div key={g.name} className={subs.group}>
          <span className={subs.groupName}>{g.name}</span>
          <span className={ui.chips}>
            {g.items.map((s) => (
              <span
                key={`${s.source}-${s.lang}-${s.from}`}
                className={ui.chip}
                data-tone={s.source === "auto" ? "ok" : undefined}
                title={s.model ? `Scritti da Whisper, modello ${s.model}` : undefined}
              >
                {languageName(s.lang)} ·{" "}
                {s.from ? `tradotto ${fromLanguage(s.from)}` : sourceNames[s.source]}
                {s.source === "auto" && (
                  <button
                    type="button"
                    className={subs.chipButton}
                    aria-label={`Cancella i sottotitoli automatici in ${languageName(s.lang).toLowerCase()}`}
                    disabled={busy}
                    onClick={() => onDelete(s.lang)}
                  >
                    <Icon name="close" size={12} />
                  </button>
                )}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

function VideoRow({
  video,
  setup,
  onChanged,
}: {
  video: SubtitledVideo;
  setup: SubtitlesSetup;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [open, setOpen] = useState<"" | "transcribe" | "translate">("");
  const r = video.request;
  const t = video.translation;
  const canListen = setup.whisper && setup.models.length > 0;
  const listening = r?.state === "running";
  const running = listening || t?.state === "running";
  const waiting = r?.state === "pending" || t?.state === "pending";
  const working = running || waiting;
  const failed = r?.state === "failed" || t?.state === "failed";
  const heard = video.subtitles.some((s) => s.source === "auto" && !s.from);

  const run = (work: () => Promise<void>) => {
    setBusy(true);
    setProblem("");
    work()
      .then(onChanged)
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non ci sono riuscito. Riprova tra poco.");
      })
      .finally(() => setBusy(false));
  };

  const closeAnd = (changed: boolean) => {
    setOpen("");
    if (changed) onChanged();
  };

  return (
    <div
      className={subs.row}
      data-state={running ? "running" : waiting ? "pending" : failed ? "failed" : undefined}
    >
      <Link
        to={`/admin/video/${video.id}`}
        className={`${ui.thumb} ${subs.thumb}`}
        data-working={running || undefined}
        tabIndex={-1}
        aria-hidden="true"
      >
        {video.cover ? (
          <img src={video.cover} alt="" loading="lazy" decoding="async" />
        ) : (
          <Icon name="subtitles" size={22} />
        )}
      </Link>
      <div className={subs.body}>
        <p className={subs.title}>
          <Link to={`/video/${video.id}`}>{video.title}</Link>
        </p>
        {!listening && (
          <Tracks
            video={video}
            busy={busy}
            onDelete={(lang) => run(() => deleteMadeSubtitles(video.id, lang))}
          />
        )}
        {listening && r && (
          <div className={subs.work}>
            <Steps r={r} />
            <ProgressBar percent={r.progress} label={`Trascrizione di ${video.title}`} />
            <Listened r={r} />
          </div>
        )}
        {r && r.state !== "done" && r.state !== "" && (
          <p className={subs.status} role="status">
            {r.state === "pending" && (
              <Chip tone="info" icon="clock">
                In coda
              </Chip>
            )}
            <span>
              {requestText(r)}: {requestDetails(r)}.
            </span>
          </p>
        )}
        {r?.state === "failed" && r.error && <p className={subs.error}>{r.error}</p>}
        {t && <Translating t={t} title={video.title} setup={setup} />}
        {problem && (
          <p role="alert" className={ui.problem}>
            {problem}
          </p>
        )}
        {open === "transcribe" && (
          <TranscribeForm
            setup={setup}
            video={video}
            onDone={() => closeAnd(true)}
            onCancel={() => closeAnd(false)}
          />
        )}
        {open === "translate" && (
          <TranslateForm
            setup={setup}
            video={video}
            onDone={() => closeAnd(true)}
            onCancel={() => closeAnd(false)}
          />
        )}
      </div>
      <div className={subs.actions}>
        {r?.state === "failed" && (
          <button
            type="button"
            className={`${ui.btn} ${ui.small}`}
            disabled={busy || !canListen}
            onClick={() =>
              run(() =>
                askSubtitles(video.id, {
                  spoken: r.spoken || spokenUnknown,
                  model: r.model,
                  translate: r.translate,
                }),
              )
            }
          >
            <Icon name="refresh" size={16} />
            Riprova
          </button>
        )}
        {r && r.state !== "done" && (
          <button
            type="button"
            className={`${ui.btn} ${ui.small} ${listening ? ui.dangerBtn : ui.ghost}`}
            disabled={busy}
            onClick={() => run(() => takeBackSubtitles(video.id))}
          >
            <Icon name="close" size={16} />
            Annulla
          </button>
        )}
        {t?.state === "failed" && (
          <button
            type="button"
            className={`${ui.btn} ${ui.small}`}
            disabled={busy}
            aria-label="Riprova la traduzione"
            onClick={() =>
              run(() =>
                askTranslation(video.id, {
                  source: t.source,
                  from: t.from,
                  to: t.to,
                  redo: t.redo,
                }),
              )
            }
          >
            <Icon name="refresh" size={16} />
            Riprova
          </button>
        )}
        {t && (
          <button
            type="button"
            className={`${ui.btn} ${ui.small} ${t.state === "running" ? ui.dangerBtn : ui.ghost}`}
            disabled={busy}
            aria-label="Annulla la traduzione"
            onClick={() => run(() => takeBackTranslation(video.id))}
          >
            <Icon name="close" size={16} />
            Annulla
          </button>
        )}
        {canListen && !working && open !== "transcribe" && (
          <button
            type="button"
            className={`${ui.btn} ${ui.small}`}
            disabled={busy}
            onClick={() => setOpen("transcribe")}
          >
            <Icon name="subtitles" size={16} />
            {heard ? "Trascrivi di nuovo" : "Trascrivi"}
          </button>
        )}
        {!working && open !== "translate" && (
          <button
            type="button"
            className={`${ui.btn} ${ui.small}`}
            disabled={busy}
            onClick={() => setOpen("translate")}
          >
            <Icon name="globe" size={16} />
            Traduci
          </button>
        )}
      </div>
    </div>
  );
}
