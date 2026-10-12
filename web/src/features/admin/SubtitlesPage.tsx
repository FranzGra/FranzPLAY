import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  askSubtitles,
  deleteMadeSubtitles,
  downloadModel,
  fetchSubtitledVideos,
  fetchSubtitlesSetup,
  languageName,
  type SubtitledVideo,
  type SubtitleRequest,
  type SubtitlesHave,
  type SubtitlesSetup,
  takeBackSubtitles,
  type VideoSubtitle,
} from "../../api/autosubs";
import { onServerEvent } from "../../api/events";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import styles from "./Admin.module.css";

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
// administrator have whisper write new ones from the sound, and have them
// translated, as the old FranzPLAY did.
export function SubtitlesPage() {
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [have, setHave] = useState<SubtitlesHave>("");
  const [lang, setLang] = useState("");
  const [state, setState] = useState<State>({ kind: "loading" });
  const shown = useRef(pageSize);

  const load = useCallback(
    (limit: number, signal?: AbortSignal) => {
      Promise.all([
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
    load(pageSize, controller.signal);
    // The work moves on in the queue: follow it.
    const stop = onServerEvent("jobs", () => load(shown.current, controller.signal));
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
    shown.current = Math.min(shown.current + pageSize, 200);
    load(shown.current);
  };
  const reload = () => load(shown.current);

  return (
    <>
      <p className={styles.lead}>
        Qui vedi quali video hanno i sottotitoli. Per quelli che non li hanno, FranzPLAY può
        scriverli da solo ascoltando l'audio con Whisper, e poi tradurli in altre lingue. Su un
        computer piccolo ci vuole tempo: un film può richiedere ore. Il lavoro si fa un video alla
        volta, quando il computer non ha altro da fare.
      </p>
      {state.kind === "ready" && <Setup setup={state.setup} onChanged={reload} />}
      <div className={styles.tools}>
        <search className={styles.searchForm}>
          <form onSubmit={search}>
            <label className={`glass ${styles.searchBox}`}>
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
        <fieldset className={styles.sections}>
          <legend className="visually-hidden">Quali video</legend>
          {filters.map((f) => (
            <button
              key={f.have}
              type="button"
              className={styles.section}
              aria-pressed={have === f.have}
              onClick={() => setHave(f.have)}
            >
              {f.label}
            </button>
          ))}
          <select
            className={`${styles.section} ${styles.select}`}
            aria-label="Lingua dei sottotitoli"
            value={lang}
            onChange={(e) => setLang(e.target.value)}
          >
            <option value="">Tutte le lingue</option>
            {(state.kind === "ready" ? state.setup.languages : []).map((l) => (
              <option key={l} value={l}>
                {languageName(l)}
              </option>
            ))}
          </select>
        </fieldset>
      </div>

      {state.kind === "loading" && <div className={styles.placeholder} aria-busy="true" />}
      {state.kind === "error" && (
        <EmptyState title="Sottotitoli non disponibili">
          Il server non ha risposto. Ricarica la pagina tra poco.
        </EmptyState>
      )}
      {state.kind === "ready" && state.videos.length === 0 && (
        <p className={styles.lead}>Nessun video qui.</p>
      )}
      {state.kind === "ready" && state.videos.length > 0 && (
        <>
          <p className={styles.count}>{state.total.toLocaleString("it-IT")} video</p>
          <ul className={styles.list} aria-label="Video">
            {state.videos.map((video) => (
              <li key={video.id}>
                <VideoRow video={video} setup={state.setup} onChanged={reload} />
              </li>
            ))}
          </ul>
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

// Setup says what is missing on this computer to make subtitles, and how
// to add it.
function Setup({ setup, onChanged }: { setup: SubtitlesSetup; onChanged: () => void }) {
  if (!setup.whisper) {
    return (
      <div className={`glass ${styles.panel}`}>
        <div>
          <p className={styles.name}>I sottotitoli automatici sono spenti</p>
          <p className={styles.role}>
            Per accenderli installa whisper.cpp su questo computer, così che il programma{" "}
            <code>whisper-cli</code> si trovi (oppure indica dov'è nell'impostazione{" "}
            <code>FRANZPLAY_WHISPER</code>), e riavvia FranzPLAY. Intanto qui vedi lo stesso quali
            video hanno già i sottotitoli.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className={`glass ${styles.panel}`}>
      <div className={styles.failed}>
        {setup.models.length === 0 ? (
          <p className={styles.name}>Manca il modello di Whisper</p>
        ) : (
          <p className={styles.name}>Whisper è pronto. Modelli: {setup.models.join(", ")}</p>
        )}
        <p className={styles.role}>
          Il modello è "l'orecchio" di Whisper. FranzPLAY può scaricarlo da solo qui sotto, oppure
          puoi mettere tu i file come <code>ggml-small.bin</code> nella cartella{" "}
          <code className={styles.path}>{setup.modelsFolder}</code>.
        </p>
        <Downloads setup={setup} onChanged={onChanged} />
        {!setup.translator && (
          <p className={styles.role}>
            Per tradurre i sottotitoli serve un server LibreTranslate: scrivi il suo indirizzo
            nell'impostazione <code>FRANZPLAY_TRANSLATE_URL</code> e riavvia FranzPLAY.
          </p>
        )}
        {setup.translatorError && (
          <p role="alert" className={styles.problem}>
            {setup.translatorError}
          </p>
        )}
      </div>
    </div>
  );
}

// megabytes writes a size for people: "466 MB".
function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1 << 20)).toLocaleString("it-IT")} MB`;
}

// Downloads lists the models FranzPLAY can download, and how the
// download goes.
function Downloads({ setup, onChanged }: { setup: SubtitlesSetup; onChanged: () => void }) {
  const [problem, setProblem] = useState("");
  const d = setup.download;
  const going = d !== null && !d.ended;
  if (setup.downloadable.length === 0) return null;

  const start = (name: string) => {
    setProblem("");
    downloadModel(name)
      .then(onChanged)
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non posso scaricarlo adesso: forse un altro modello sta già scaricando.");
      });
  };

  return (
    <>
      <ul className={styles.models} aria-label="Modelli da scaricare">
        {setup.downloadable.map((m) => {
          const here = setup.models.includes(m.name);
          return (
            <li key={m.name} className={styles.model}>
              <span>
                <strong>{m.name}</strong> · {megabytes(m.size)}
                <span className={styles.role}> {m.about}</span>
              </span>
              {here ? (
                <span className={styles.role}>Già qui</span>
              ) : (
                <button
                  type="button"
                  className={`glass ${styles.action}`}
                  disabled={going}
                  onClick={() => start(m.name)}
                  aria-label={`Scarica ${m.name}`}
                >
                  Scarica
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {d && going && (
        <p className={styles.role} role="status">
          Scarico {d.name}: {megabytes(d.done)}
          {d.total > 0 && ` di ${megabytes(d.total)}`}…
        </p>
      )}
      {d?.ended && d.error === "" && (
        <p className={styles.done} role="status">
          {d.name} scaricato.
        </p>
      )}
      {d?.ended && d.error !== "" && (
        <p className={styles.problem} role="alert">
          {d.name}: {d.error}
        </p>
      )}
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
    </>
  );
}

// sourceNames say where a subtitle comes from.
const sourceNames: Record<VideoSubtitle["source"], string> = {
  file: "file accanto",
  inside: "nel video",
  auto: "automatici",
};

// requestText says how the work on a video goes.
function requestText(r: SubtitleRequest): string {
  if (r.state === "failed") return "Non riuscito";
  if (r.state === "done") return "Pronti";
  if (r.state === "pending") return "In coda";
  switch (r.stage) {
    case "audio":
      return "Prendo l'audio dal video";
    case "transcribe":
      return "Whisper sta ascoltando";
    case "translate":
      return "Traduco";
    default:
      return "Al lavoro";
  }
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
  const [asking, setAsking] = useState(false);
  const r = video.request;
  const canAsk = setup.whisper && setup.models.length > 0;

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

  return (
    <div className={`glass ${styles.person}`}>
      <div className={styles.videoInfo}>
        <span className={styles.thumb}>
          {video.cover ? (
            <img src={video.cover} alt="" loading="lazy" decoding="async" />
          ) : (
            <Icon name="subtitles" size={18} />
          )}
        </span>
        <div className={styles.failed}>
          <p className={styles.name}>
            <Link to={`/video/${video.id}`}>{video.title}</Link>
          </p>
          <p className={styles.badges}>
            {video.subtitles.length === 0 && (
              <span className={styles.role}>Nessun sottotitolo</span>
            )}
            {video.subtitles.map((s) => (
              <span key={`${s.source}-${s.lang}-${s.from}`} className={styles.langBadge}>
                {languageName(s.lang)} · {s.from ? "tradotti" : sourceNames[s.source]}
                {s.source === "auto" && (
                  <button
                    type="button"
                    className={styles.badgeButton}
                    aria-label={`Cancella i sottotitoli automatici in ${languageName(s.lang).toLowerCase()}`}
                    disabled={busy}
                    onClick={() => run(() => deleteMadeSubtitles(video.id, s.lang))}
                  >
                    <Icon name="close" size={12} />
                  </button>
                )}
              </span>
            ))}
          </p>
          {r && (
            <p className={styles.role} role="status">
              {requestText(r)}: modello {r.model}
              {r.translate.length > 0 &&
                `, tradotti in ${r.translate.map((l) => languageName(l).toLowerCase()).join(", ")}`}
              .
            </p>
          )}
          {r?.state === "failed" && r.error && <p className={styles.error}>{r.error}</p>}
          {problem && (
            <p role="alert" className={styles.problem}>
              {problem}
            </p>
          )}
        </div>
      </div>
      <div className={styles.buttons}>
        {r?.state === "failed" && (
          <button
            type="button"
            className={`glass ${styles.action}`}
            disabled={busy || !canAsk}
            onClick={() =>
              run(() =>
                askSubtitles(video.id, {
                  spoken: r.spoken,
                  model: r.model,
                  translate: r.translate,
                }),
              )
            }
          >
            Riprova
          </button>
        )}
        {r && r.state !== "done" && (
          <button
            type="button"
            className={`glass ${styles.action}`}
            disabled={busy}
            onClick={() => run(() => takeBackSubtitles(video.id))}
          >
            Annulla
          </button>
        )}
        {canAsk && !asking && (
          <button
            type="button"
            className={`glass ${styles.action}`}
            disabled={busy}
            onClick={() => setAsking(true)}
          >
            Crea sottotitoli
          </button>
        )}
      </div>
      {asking && (
        <AskForm
          setup={setup}
          video={video}
          onDone={() => {
            setAsking(false);
            onChanged();
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </div>
  );
}

// AskForm asks whisper for the subtitles of one video.
function AskForm({
  setup,
  video,
  onDone,
  onCancel,
}: {
  setup: SubtitlesSetup;
  video: SubtitledVideo;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [spoken, setSpoken] = useState(video.request?.spoken ?? "");
  const [model, setModel] = useState(
    video.request && setup.models.includes(video.request.model)
      ? video.request.model
      : setup.models.includes("small")
        ? "small"
        : (setup.models[0] ?? ""),
  );
  const [translate, setTranslate] = useState<string[]>(video.request?.translate ?? []);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const canTranslate = setup.translator && setup.translatorError === "";
  const targets = setup.languages.filter(
    (l) => l !== spoken && setup.translatorLanguages.includes(l),
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    askSubtitles(video.id, {
      spoken,
      model,
      translate: canTranslate ? translate.filter((l) => targets.includes(l)) : [],
    })
      .then(onDone)
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non ci sono riuscito. Riprova tra poco.");
        setBusy(false);
      });
  };

  return (
    <form className={styles.inline} onSubmit={submit} aria-label={`Sottotitoli di ${video.title}`}>
      <label className={styles.field}>
        Lingua parlata nel video
        <select value={spoken} onChange={(e) => setSpoken(e.target.value)}>
          <option value="">La indovina Whisper</option>
          {setup.languages.map((l) => (
            <option key={l} value={l}>
              {languageName(l)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        Modello
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          {setup.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      {canTranslate && targets.length > 0 && (
        <fieldset className={styles.field}>
          <legend>Traduci anche in</legend>
          <span className={styles.buttons}>
            {targets.map((l) => (
              <label key={l} className={styles.check}>
                <input
                  type="checkbox"
                  checked={translate.includes(l)}
                  onChange={(e) =>
                    setTranslate((t) => (e.target.checked ? [...t, l] : t.filter((x) => x !== l)))
                  }
                />
                {languageName(l)}
              </label>
            ))}
          </span>
        </fieldset>
      )}
      <span className={styles.buttons}>
        <button type="submit" className={styles.primary} disabled={busy}>
          Crea
        </button>
        <button type="button" className={`glass ${styles.action}`} onClick={onCancel}>
          Lascia stare
        </button>
      </span>
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
    </form>
  );
}
