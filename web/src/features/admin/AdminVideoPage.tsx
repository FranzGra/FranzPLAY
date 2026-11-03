import {
  type FormEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useParams } from "react-router";
import {
  type AdminVideo,
  fetchAdminVideo,
  maxCategory,
  maxTitle,
  refreshVideo,
  setVideoDetails,
  setVideoHidden,
} from "../../api/adminVideos";
import { languageName } from "../../api/autosubs";
import { ApiError } from "../../api/client";
import { onServerEvent } from "../../api/events";
import { fetchVideoQueue, type Job, retryJob, setVideoPriority } from "../../api/jobs";
import { makePublicLink, revokePublicLink } from "../../api/publicLinks";
import {
  canPlayType,
  fetchCategories,
  playsFileItself,
  prepareVideo,
  streamURL,
} from "../../api/videos";
import { Byline } from "../../components/Byline";
import { ComboBox } from "../../components/ComboBox";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { BusyRing, LiveDot, ProgressBar } from "../../components/ProgressBar";
import { formatDuration, formatSince } from "../../lib/format";
import { Player } from "../player/Player";
import { useSkip } from "../player/useSkip";
import { useSubtitles } from "../player/useSubtitles";
import { copyText } from "../share/copyText";
import { fullLink } from "../sharing/audience";
import { useCrumb } from "./AdminPage";
import { runningJobs, throttle, useActivity } from "./activity";
import { ClipForm } from "./ClipForm";
import { CoverForm } from "./CoverForm";
import edit from "./Edit.module.css";
import { fileProblemText } from "./fileProblem";
import {
  forgetJobVideo,
  kindNames,
  progressText,
  stageNames,
  workNumbers,
  workPercent,
} from "./jobText";
import { OwnerChoice } from "./OwnerChoice";
import { compatibility, qualityLabel } from "./quality";
import { SubtitleImport } from "./SubtitleImport";
import { Card, Chip, Empty, Loading, SettingSwitch, Unavailable, ui, useToast } from "./ui";

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ready"; video: AdminVideo };

// ListState is what the list hands to the page of a video: the videos in
// its order, to go to the one before and after.
export type ListState = { ids: number[] };

function idsFrom(state: unknown): number[] {
  const ids = (state as ListState | null)?.ids;
  return Array.isArray(ids) ? ids.filter((n) => Number.isInteger(n)) : [];
}

type SetVideo = (next: AdminVideo | ((video: AdminVideo) => AdminVideo)) => void;
type Say = (text: string, problem?: boolean) => void;

const failed = "Non ci sono riuscito. Riprova tra poco.";

// AdminVideoPage is one video as the administrator changes it: the video,
// its cover and its clip on the left; its details, who sees it, the work
// on it and its file on the right. Title and category wait for "Salva
// modifiche"; the switches and the cover act at once and say so.
export function AdminVideoPage() {
  const param = useParams().id ?? "";
  const id = /^\d+$/.test(param) ? Number(param) : 0;
  const location = useLocation();
  const ids = idsFrom(location.state);
  const [state, setState] = useState<State>({ kind: "loading" });
  usePageTitle(state.kind === "ready" ? state.video.title : "Video");
  useCrumb(state.kind === "ready" ? state.video.title : "");

  useEffect(() => {
    if (id <= 0) {
      setState({ kind: "missing" });
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetchAdminVideo(id, controller.signal)
      .then((video) => setState({ kind: "ready", video }))
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

  const setVideo = useCallback<SetVideo>((next) => {
    setState((s) =>
      s.kind === "ready"
        ? { kind: "ready", video: typeof next === "function" ? next(s.video) : next }
        : s,
    );
  }, []);

  if (state.kind === "loading") return <Loading />;
  if (state.kind === "missing") {
    return (
      <Empty
        icon="film"
        title="Video non trovato"
        action={
          <Link to="/admin/video" className={ui.btn}>
            Tutti i video
          </Link>
        }
      >
        Questo video non c'è più.
      </Empty>
    );
  }
  if (state.kind === "error") return <Unavailable title="Video non disponibile" />;
  return <Detail key={state.video.id} video={state.video} setVideo={setVideo} ids={ids} />;
}

// useCoverWatch waits for a new cover after a choice: the server makes it
// in the queue, then the video's cover gets a new address. Until then
// the page says "Preparo la nuova copertina…"; it asks again when the
// queue or the library change (and every few seconds, in case a message
// was lost), and puts the new cover in place by itself.
function useCoverWatch(video: AdminVideo, setVideo: SetVideo, say: Say) {
  const [pending, setPending] = useState<{ from: string | null } | null>(null);
  const said = useRef(say);
  useLayoutEffect(() => {
    said.current = say;
  });

  useEffect(() => {
    if (!pending) return;
    let alive = true;
    const check = () => {
      fetchAdminVideo(video.id)
        .then((fresh) => {
          if (!alive || fresh.cover === pending.from) return;
          alive = false;
          forgetJobVideo(video.id);
          setVideo((v) => ({
            ...v,
            cover: fresh.cover,
            coverChoice: fresh.coverChoice,
            coverSecond: fresh.coverSecond,
            preview: fresh.preview,
          }));
          setPending(null);
          said.current("Copertina aggiornata.");
        })
        .catch(() => {
          // A failed question is asked again at the next message.
        });
    };
    check();
    const stopJobs = onServerEvent("jobs", check);
    const stopLibrary = onServerEvent("library", check);
    const timer = window.setInterval(check, 4000);
    // After two minutes stop waiting: the work may have failed.
    const giveUp = window.setTimeout(() => {
      if (!alive) return;
      alive = false;
      setPending(null);
      said.current("La copertina ci mette più del solito: guarda in Lavori.", true);
    }, 120_000);
    return () => {
      alive = false;
      stopJobs();
      stopLibrary();
      window.clearInterval(timer);
      window.clearTimeout(giveUp);
    };
  }, [pending, video.id, setVideo]);

  const wait = useCallback(() => setPending({ from: video.cover }), [video.cover]);
  return { pending: pending !== null, wait };
}

function Detail({
  video,
  setVideo,
  ids,
}: {
  video: AdminVideo;
  setVideo: SetVideo;
  ids: number[];
}) {
  const [toast, say] = useToast();
  const cover = useCoverWatch(video, setVideo, say);
  const [title, setTitle] = useState(video.title);
  const [category, setCategory] = useState(video.category);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const titleField = useRef<HTMLInputElement>(null);
  const formId = useId();
  const dirty = title !== video.title || category !== video.category;
  const quality = qualityLabel(video.height);
  const compat = compatibility(video);
  const watchable = !(
    video.hidden ||
    video.missing ||
    video.fileProblem ||
    video.tooShort ||
    video.private
  );

  const at = ids.indexOf(video.id);
  const before = at > 0 ? ids[at - 1] : undefined;
  const after = at >= 0 && at < ids.length - 1 ? ids[at + 1] : undefined;

  const save = (event: FormEvent) => {
    event.preventDefault();
    const t = title.trim();
    const c = category.trim();
    if (t === "" || [...t].length > maxTitle) {
      setProblem(`Il titolo deve avere da 1 a ${maxTitle} caratteri.`);
      return;
    }
    if ([...c].length > maxCategory) {
      setProblem(`La categoria può avere al massimo ${maxCategory} caratteri.`);
      return;
    }
    // Writing back exactly what was found means "as found": it then
    // follows the file again if it is renamed or moved.
    const details = {
      title: t === video.foundTitle ? null : t,
      category: c === video.foundCategory ? null : c,
    };
    setBusy(true);
    setProblem("");
    setVideoDetails(video.id, details)
      .then(() => {
        setTitle(t);
        setCategory(c);
        setVideo((v) => ({
          ...v,
          title: t,
          category: c,
          titleSet: details.title !== null,
          categorySet: details.category !== null,
        }));
        say("Modifiche salvate.");
      })
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non si è riusciti a salvare. Riprova tra poco.");
      })
      .finally(() => setBusy(false));
  };

  const undo = () => {
    setTitle(video.title);
    setCategory(video.category);
    setProblem("");
  };

  const changed =
    title !== video.title && category !== video.category
      ? "Titolo e categoria cambiati, non salvati"
      : title !== video.title
        ? "Titolo cambiato, non salvato"
        : "Categoria cambiata, non salvata";

  return (
    <>
      <header className={edit.head}>
        <div className={edit.headTop}>
          <Link to="/admin/video" className={ui.pageBack}>
            <Icon name="chevronLeft" size={18} />
            Tutti i video
          </Link>
          {at >= 0 && ids.length > 1 && (
            <nav className={edit.steps} aria-label="Altri video">
              <StepLink to={before} ids={ids} label="Video precedente" icon="chevronLeft" />
              <span className={edit.stepCount}>
                {at + 1} di {ids.length}
              </span>
              <StepLink to={after} ids={ids} label="Video successivo" icon="chevronRight" />
            </nav>
          )}
        </div>
        <div className={edit.titleRow}>
          <h1 className={edit.title}>{video.title}</h1>
          <button
            type="button"
            className={`${ui.btn} ${ui.small} ${ui.ghost}`}
            onClick={() => {
              titleField.current?.focus();
              titleField.current?.select();
            }}
          >
            <Icon name="edit" size={16} />
            Cambia titolo
          </button>
        </div>
        <div className={edit.headInfo}>
          <span className={edit.owner}>
            <Byline owner={video.owner} size={24} />
          </span>
          {video.duration !== null && <Chip>{formatDuration(video.duration)}</Chip>}
          {quality && <Chip>{quality}</Chip>}
          {compat && (
            <Chip tone={compat.ok ? "ok" : "warn"} icon={compat.ok ? "check" : "alert"}>
              {compat.label}
            </Chip>
          )}
          {video.missing && <Chip tone="bad">File non trovato</Chip>}
          {video.fileProblem && !video.missing && <Chip tone="bad">File illeggibile</Chip>}
          {video.hidden && <Chip tone="warn">Nascosto</Chip>}
          {video.tooShort && <Chip tone="warn">Troppo corto</Chip>}
          {video.private && <Chip tone="info">Privato</Chip>}
        </div>
        <div className={edit.headActions}>
          {dirty && (
            <span className={edit.unsaved} role="status">
              <span className={edit.unsavedDot} />
              {changed}
            </span>
          )}
          {watchable && (
            <Link to={`/video/${video.id}`} className={ui.btn}>
              <Icon name="play" size={16} />
              Apri pagina
            </Link>
          )}
          {dirty && (
            <>
              <button type="button" className={`${ui.btn} ${ui.ghost}`} onClick={undo}>
                Annulla
              </button>
              <button
                type="submit"
                form={formId}
                className={`${ui.btn} ${ui.primary}`}
                disabled={busy}
              >
                <Icon name="save" size={16} />
                Salva modifiche
              </button>
            </>
          )}
        </div>
      </header>

      <div className={edit.layout}>
        <div className={edit.column}>
          <div className={edit.stageBox} data-order="1">
            <Stage video={video} watchable={watchable} say={say} />
          </div>
          <div data-order="3">
            <CoverForm
              video={video}
              pending={cover.pending}
              onAsked={(message) => {
                cover.wait();
                say(message);
              }}
            />
          </div>
          <div data-order="5">
            <ClipForm
              video={video}
              onChosen={(changed, message) => {
                setVideo(changed);
                say(message);
              }}
            />
          </div>
        </div>

        <div className={edit.column}>
          <div data-order="2">
            <Card title="Dettagli" icon="edit">
              <Details
                formId={formId}
                video={video}
                title={title}
                category={category}
                onTitle={setTitle}
                onCategory={setCategory}
                problem={problem}
                titleField={titleField}
                onSubmit={save}
              />
            </Card>
          </div>
          <div data-order="4">
            <Card title="Chi lo vede" icon="eye">
              <Audience video={video} />
              {video.private && !video.uploader && !video.missing && (
                <OwnerChoice
                  video={video}
                  onDone={(message) => {
                    say(message);
                    fetchAdminVideo(video.id)
                      .then(setVideo)
                      .catch((error: unknown) => console.error(error));
                  }}
                  onFailed={() => say(failed, true)}
                />
              )}
              <div className={ui.settingList}>
                <SettingSwitch
                  label="Nascosto"
                  hint="Non compare nelle liste e nessuno lo apre. Mi piace e commenti restano."
                  on="Nascosto"
                  off="Visibile"
                  checked={video.hidden}
                  disabled={video.missing}
                  onChange={async (hidden) => {
                    try {
                      await setVideoHidden(video.id, hidden);
                      setVideo((v) => ({ ...v, hidden }));
                      say(hidden ? "Nascosto a tutti." : "Di nuovo visibile a tutti.");
                    } catch (error) {
                      console.error(error);
                      say(failed, true);
                    }
                  }}
                />
                {!video.missing && <PublicLink video={video} setVideo={setVideo} say={say} />}
              </div>
            </Card>
          </div>
          <div data-order="6">
            <VideoJobs video={video} coverPending={cover.pending} say={say} />
          </div>
          <div data-order="7">
            <FileCard video={video} say={say} />
          </div>
          <div data-order="8">
            <SubtitlesCard video={video} say={say} />
          </div>
        </div>
      </div>
      {toast}
    </>
  );
}

function StepLink({
  to,
  ids,
  label,
  icon,
}: {
  to: number | undefined;
  ids: number[];
  label: string;
  icon: "chevronLeft" | "chevronRight";
}) {
  if (to === undefined) {
    return (
      <span className={`${ui.btn} ${ui.small} ${ui.iconBtn} ${edit.stepOff}`} aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
    );
  }
  return (
    <Link
      to={`/admin/video/${to}`}
      state={{ ids } satisfies ListState}
      className={`${ui.btn} ${ui.small} ${ui.iconBtn}`}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} size={18} />
    </Link>
  );
}

// StagePlayer plays the video as its public page does, with its subtitles.
// They are asked again when the work or the library change, so a subtitle
// just made or removed comes and goes without opening the page again.
function StagePlayer({ video }: { video: AdminVideo }) {
  const { skip, onSkip } = useSkip();
  const [round, setRound] = useState(0);
  useEffect(() => {
    const again = throttle(() => setRound((r) => r + 1), 2000);
    const stopJobs = onServerEvent("jobs", again.call);
    const stopLibrary = onServerEvent("library", again.call);
    return () => {
      stopJobs();
      stopLibrary();
      again.cancel();
    };
  }, []);
  const subtitles = useSubtitles(video.id, round);
  return (
    <div className={edit.stage}>
      <Player
        src={streamURL(video.id, video.copy && playsFileItself(video, canPlayType))}
        poster={video.cover}
        subtitles={subtitles}
        preview={video.preview}
        length={video.duration}
        autoPlay
        skip={skip}
        onSkip={onSkip}
      />
    </div>
  );
}

// whyNoPlay says why a video has no play button, the most important reason
// first; null when it has one.
function whyNoPlay(video: AdminVideo): { title: string; text: string; copy?: boolean } | null {
  if (video.missing) {
    return {
      title: "Il file non c'è più",
      text: "Non è più nella sua cartella. Se l'hai solo spostato, FranzPLAY lo ritrova al prossimo controllo.",
    };
  }
  if (video.fileProblem) {
    return { title: "File illeggibile", text: fileProblemText[video.fileProblem] };
  }
  if (video.hidden) {
    return {
      title: "Video nascosto",
      text: "Non lo vede nessuno: per guardarlo, rendilo di nuovo visibile.",
    };
  }
  if (video.tooShort) {
    const lasts = video.duration === null ? "" : `Dura ${formatDuration(video.duration)}: `;
    const minimum =
      video.minDuration > 0
        ? `il minimo scelto per le cartelle è ${formatDuration(video.minDuration)}.`
        : "è sotto il minimo scelto per le cartelle.";
    return { title: "Troppo corto", text: `${lasts}${minimum} Non lo vede nessuno.` };
  }
  if (video.private) {
    return {
      title: "Video privato",
      text: "Non si guarda da qui: per cambiarlo, vai a «Chi lo vede».",
    };
  }
  if (video.duration === null) {
    return {
      title: "Non ancora letto",
      text: "FranzPLAY sta ancora leggendo il file: tra poco si può guardare.",
    };
  }
  if (!video.playable) {
    return {
      title: "Formato non diretto",
      text: "I browser non riescono ad aprire questo formato: serve una copia compatibile.",
      copy: true,
    };
  }
  return null;
}

// Stage is the video itself: its cover with a play button, which starts
// the player in its place. Without the button, the box says why.
function Stage({ video, watchable, say }: { video: AdminVideo; watchable: boolean; say: Say }) {
  const [playing, setPlaying] = useState(false);
  if (playing) return <StagePlayer video={video} />;
  const why = whyNoPlay(video);
  return (
    <div className={edit.stage}>
      {video.cover ? (
        <img className={edit.poster} src={video.cover} alt="" />
      ) : (
        <span className={edit.noPoster}>{!why && <Icon name="film" size={40} />}</span>
      )}
      {why && (
        <div className={edit.stageWhy}>
          <p className={edit.stageWhyTitle}>{why.title}</p>
          <p className={edit.stageWhyText}>{why.text}</p>
          {why.copy && <CopyButton video={video} say={say} />}
        </div>
      )}
      {!why && watchable && (
        <button
          type="button"
          className={edit.play}
          aria-label={`Guarda ${video.title}`}
          onClick={() => setPlaying(true)}
        >
          <Icon name="play" size={30} />
        </button>
      )}
    </div>
  );
}

// Details are the title and the category, changed in place; the buttons to
// save them come up on top as soon as one differs.
function Details({
  formId,
  video,
  title,
  category,
  onTitle,
  onCategory,
  problem,
  titleField,
  onSubmit,
}: {
  formId: string;
  video: AdminVideo;
  title: string;
  category: string;
  onTitle: (t: string) => void;
  onCategory: (c: string) => void;
  problem: string;
  titleField: RefObject<HTMLInputElement | null>;
  onSubmit: (event: FormEvent) => void;
}) {
  const [categories, setCategories] = useState<string[]>([]);
  const titleId = useId();
  const categoryId = useId();
  // A category just saved may be a new one: ask for the list again.
  const saved = video.category;

  // biome-ignore lint/correctness/useExhaustiveDependencies: saved is what asks again.
  useEffect(() => {
    const controller = new AbortController();
    fetchCategories(controller.signal)
      .then((list) => setCategories(list.map((c) => c.name)))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, [saved]);

  return (
    <form id={formId} className={edit.details} onSubmit={onSubmit} aria-label="Titolo e categoria">
      <div className={ui.field}>
        <label htmlFor={titleId} className={ui.label}>
          Titolo
        </label>
        <span className={edit.titleBox}>
          <input
            ref={titleField}
            id={titleId}
            className={`${ui.input} ${edit.titleInput}`}
            value={title}
            maxLength={maxTitle}
            onChange={(e) => onTitle(e.target.value)}
          />
          <Icon name="edit" size={18} />
        </span>
        <p className={ui.hint}>
          {title.trim() === video.foundTitle ? (
            "Come il nome del file."
          ) : (
            <>
              Dal nome del file: «{video.foundTitle}».{" "}
              <button type="button" className={ui.link} onClick={() => onTitle(video.foundTitle)}>
                Usa questo
              </button>
            </>
          )}
        </p>
      </div>
      <div className={ui.field}>
        <label htmlFor={categoryId} className={ui.label}>
          Categoria
        </label>
        <ComboBox
          id={categoryId}
          inputClassName={ui.input}
          value={category}
          options={categories}
          maxLength={maxCategory}
          placeholder="Nessuna categoria"
          toggleLabel="Elenco delle categorie"
          newLabel={(text) => `Nuova categoria: «${text}»`}
          onChange={onCategory}
        />
        <p className={ui.hint}>
          {category.trim() === video.foundCategory ? (
            video.foundCategory ? (
              "Come la cartella in cui si trova."
            ) : (
              "Scrivine una nuova o scegline una esistente."
            )
          ) : (
            <>
              {video.foundCategory
                ? `Dalla cartella: «${video.foundCategory}». `
                : "La cartella non ne dà una. "}
              <button
                type="button"
                className={ui.link}
                onClick={() => onCategory(video.foundCategory)}
              >
                Usa questa
              </button>
            </>
          )}
        </p>
      </div>
      <div className={edit.authorRow}>
        <span className={ui.label}>Autore</span>
        <span className={edit.owner}>
          <Byline owner={video.owner} size={28} />
        </span>
        <span className={ui.hint}>
          {video.uploader
            ? `Caricato da ${video.uploader.name}`
            : `Trovato nella cartella ${video.folder}`}
        </span>
      </div>
      {problem && (
        <p role="alert" className={ui.problem}>
          {problem}
        </p>
      )}
    </form>
  );
}

// Audience says who sees the video. Only its uploader chooses that for
// an upload; a video of the folders is for everybody with an account.
function Audience({ video }: { video: AdminVideo }) {
  const choice = !video.private ? "everyone" : video.link !== null ? "link" : "uploader";
  const options = [
    { id: "everyone", icon: "people" as const, label: "Tutti con account" },
    { id: "link", icon: "link" as const, label: "Chi ha il link" },
    { id: "uploader", icon: "lock" as const, label: "Chi l'ha caricato" },
  ];
  return (
    <div className={edit.audience}>
      <fieldset className={ui.segmented} disabled>
        <legend className="visually-hidden">Chi lo vede</legend>
        {options.map((o) => (
          <label key={o.id} className={ui.segment}>
            <input
              type="radio"
              name={`audience-${video.id}`}
              className="visually-hidden"
              checked={choice === o.id}
              readOnly
            />
            <Icon name={o.icon} size={16} />
            {o.label}
          </label>
        ))}
      </fieldset>
      <p className={ui.hint}>
        {video.uploader
          ? `Lo sceglie ${video.uploader.name}, che l'ha caricato.`
          : video.private
            ? "Lo sceglie chi l'ha caricato: ora non ha un proprietario."
            : "I video delle cartelle li vedono tutti quelli che hanno un account."}
        {video.tooShort && " È più corto del minimo scelto per le cartelle: per ora non compare."}
      </p>
    </div>
  );
}

// PublicLink turns the public link on and off; on, its address is there
// to copy, and a new one can replace it.
function PublicLink({ video, setVideo, say }: { video: AdminVideo; setVideo: SetVideo; say: Say }) {
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const link = video.publicLink;

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const make = async (message: string) => {
    setBusy(true);
    try {
      const next = await makePublicLink(video.id);
      setVideo((v) => ({ ...v, publicLink: next.link }));
      say(message);
    } catch (error) {
      console.error(error);
      say(failed, true);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    setBusy(true);
    try {
      await revokePublicLink(video.id);
      setVideo((v) => ({ ...v, publicLink: null }));
      setAsking(false);
      say("Link pubblico disattivato: non funziona più.");
    } catch (error) {
      console.error(error);
      say(failed, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingSwitch
        label="Link pubblico"
        hint="Chiunque abbia il link può guardarlo, anche senza account."
        checked={link !== null}
        disabled={busy}
        onChange={async (on) => {
          if (on) await make("Link pubblico creato.");
          else setAsking(true);
        }}
      />
      {asking && (
        <div className={edit.confirm} role="alertdialog" aria-label="Disattivare il link?">
          <p>Disattivarlo? Chi ha il link non potrà più aprirlo.</p>
          <button
            type="button"
            className={`${ui.btn} ${ui.small}`}
            onClick={() => setAsking(false)}
          >
            Annulla
          </button>
          <button
            type="button"
            className={`${ui.btn} ${ui.small} ${ui.dangerBtn}`}
            disabled={busy}
            onClick={() => void revoke()}
          >
            Disattiva
          </button>
        </div>
      )}
      {link !== null && (
        <div className={edit.linkBox}>
          <div className={edit.linkField}>
            <input
              ref={field}
              className={`${ui.input} ${ui.mono}`}
              value={fullLink(link)}
              readOnly
              aria-label="Link pubblico"
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              className={`${ui.btn} ${ui.iconBtn}`}
              aria-label={copied ? "Copiato" : "Copia link"}
              title={copied ? "Copiato" : "Copia link"}
              onClick={() =>
                copyText(fullLink(link))
                  .then(() => setCopied(true))
                  .catch((error: unknown) => {
                    console.error(error);
                    field.current?.select();
                    say("Non riesco a copiarlo: è selezionato, copialo tu.", true);
                  })
              }
            >
              <Icon name={copied ? "check" : "copy"} size={18} />
            </button>
          </div>
          <p className={ui.hint}>
            {copied ? "Copiato. " : ""}
            <button
              type="button"
              className={ui.link}
              disabled={busy}
              onClick={() => void make("Nuovo link creato: quello vecchio non funziona più.")}
            >
              Genera nuovo link
            </button>
          </p>
        </div>
      )}
    </>
  );
}

// VideoJobs is the work on this video: what runs now, the new cover being
// made, what failed with "Riprova", and the button to make it all again.
function VideoJobs({
  video,
  coverPending,
  say,
}: {
  video: AdminVideo;
  coverPending: boolean;
  say: Say;
}) {
  const { jobs, refresh } = useActivity();
  const [busy, setBusy] = useState(false);
  const runningHere = runningJobs(jobs).filter((j) => j.videoId === video.id);
  const running = runningHere[0] ?? null;
  // Asked by video, since the queue of the whole site shows only its first
  // jobs. Asked again whenever the queue moves.
  const [videoQueue, setVideoQueue] = useState<Job[] | null>(null);
  useEffect(() => {
    if (!jobs) return;
    const asking = new AbortController();
    fetchVideoQueue(video.id, asking.signal)
      .then(setVideoQueue)
      .catch((error: unknown) => {
        if (!asking.signal.aborted) console.error(error);
      });
    return () => asking.abort();
  }, [video.id, jobs]);
  const queuedHere = videoQueue ?? jobs?.queue.filter((j) => j.videoId === video.id) ?? [];
  const allFirst = queuedHere.length > 0 && queuedHere.every((j) => j.urgent);
  const failedHere = jobs?.failed.filter((j) => j.videoId === video.id) ?? [];
  const quiet = !running && !coverPending && failedHere.length === 0 && queuedHere.length === 0;
  const coverQueued = queuedHere.some((j) => j.kind === "cover");
  return (
    <Card
      title="Lavori su questo video"
      icon={running || coverPending ? <BusyRing size={20} /> : "layers"}
      tone={running ? "busy" : undefined}
    >
      <ul className={edit.jobList}>
        {runningHere.map((job) => {
          const how = progressText(job);
          const heard = workNumbers(job);
          return (
            <li key={job.id} className={edit.jobRow}>
              <span className={edit.jobHead}>
                <Chip tone="live" icon={<LiveDot />}>
                  {kindNames[job.kind]}
                </Chip>
                {job.stage && stageNames[job.stage] && (
                  <Chip tone="info">{stageNames[job.stage]}</Chip>
                )}
                <span className={edit.jobWhen}>
                  da {formatSince(job.startedAt ?? job.at, new Date())}
                </span>
              </span>
              <ProgressBar percent={workPercent(job)} label={`${kindNames[job.kind]} in corso`} />
              {(how || heard) && (
                <span className={edit.jobWhen}>{[how, heard].filter(Boolean).join(" · ")}</span>
              )}
            </li>
          );
        })}
        {queuedHere.map((job) => (
          <li key={job.id} className={edit.jobRow}>
            <span className={edit.jobHead}>
              <Chip tone="info" icon="clock">
                {kindNames[job.kind]}
              </Chip>
              {job.urgent && <Chip tone="info">Con priorità</Chip>}
              <span className={edit.jobWhen}>in coda</span>
            </span>
          </li>
        ))}
        {coverPending && !coverQueued && !runningHere.some((j) => j.kind === "cover") && (
          <li className={edit.jobRow}>
            <span className={edit.jobHead}>
              <Chip tone="info">Copertina</Chip>
              <span className={edit.jobWhen}>in coda, arriva tra poco</span>
            </span>
          </li>
        )}
        {failedHere.map((job) => (
          <li key={job.id} className={edit.jobRow}>
            <span className={edit.jobHead}>
              <Chip tone="bad">{kindNames[job.kind]}</Chip>
              <span className={edit.jobWhen}>non riuscito · {formatSince(job.at, new Date())}</span>
              <button
                type="button"
                className={`${ui.btn} ${ui.small}`}
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  retryJob(job.id)
                    .then(() => {
                      say("Lavoro rimesso in coda.");
                      refresh();
                    })
                    .catch(() => say(failed, true))
                    .finally(() => setBusy(false));
                }}
              >
                Riprova
              </button>
            </span>
            <span className={edit.jobError}>{job.error}</span>
          </li>
        ))}
      </ul>
      {quiet && (
        <p className={ui.cardText}>
          Nessun lavoro in corso: copertina, anteprime e lettura del file sono pronte.
        </p>
      )}
      {queuedHere.length > 0 && (
        <button
          type="button"
          className={`${ui.btn} ${ui.small}`}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setVideoPriority(video.id, !allFirst)
              .then(() => {
                say(
                  allFirst
                    ? "I lavori di questo video tornano al loro posto."
                    : "I lavori di questo video sono in cima alla coda.",
                );
                refresh();
              })
              .catch(() => say(failed, true))
              .finally(() => setBusy(false));
          }}
        >
          <Icon name={allFirst ? "close" : "upload"} size={16} />
          {allFirst ? "Togli priorità" : "Dai la priorità"}
        </button>
      )}
      <button
        type="button"
        className={`${ui.btn} ${ui.small}`}
        disabled={busy || video.missing}
        onClick={() => {
          setBusy(true);
          refreshVideo(video.id)
            .then(() => {
              say("In coda: FranzPLAY rilegge il video e rifà copertina e anteprime.");
              refresh();
            })
            .catch(() => say(failed, true))
            .finally(() => setBusy(false));
        }}
      >
        <Icon name="refresh" size={16} />
        Rileggi il video
      </button>
    </Card>
  );
}

// SubtitlesCard brings a subtitle file for the video: an .srt or .vtt kept
// as the subtitles of one language, like the ones whisper writes. The
// player above shows them as soon as they are saved.
function SubtitlesCard({ video, say }: { video: AdminVideo; say: Say }) {
  const [open, setOpen] = useState(false);
  return (
    <Card title="Sottotitoli" icon="subtitles">
      {open ? (
        <SubtitleImport
          videoId={video.id}
          title={video.title}
          onDone={(lang) => {
            setOpen(false);
            say(`Sottotitoli importati: ${languageName(lang).toLowerCase()}.`);
          }}
          onCancel={() => setOpen(false)}
        />
      ) : (
        <>
          <p className={ui.cardText}>
            Hai già un file di sottotitoli per questo video? Importalo: si vede nel lettore come
            quelli scritti da Whisper, e si può tradurre.
          </p>
          <span className={ui.chips}>
            <button type="button" className={ui.btn} onClick={() => setOpen(true)}>
              <Icon name="upload" size={16} />
              Importa sottotitoli
            </button>
            <Link to="/admin/sottotitoli" className={`${ui.btn} ${ui.ghost}`}>
              Tutti i sottotitoli
            </Link>
          </span>
        </>
      )}
    </Card>
  );
}

// FileCard is the file of the video: where it is, what it is made of, and
// whether every browser plays it, with the button to make a copy.
function FileCard({ video, say }: { video: AdminVideo; say: Say }) {
  const compat = compatibility(video);
  const unread = video.fileProblem ? "File illeggibile" : null;
  const format = [video.format, video.videoCodec.toUpperCase(), video.audioCodec.toUpperCase()]
    .filter(Boolean)
    .join(" · ");
  return (
    <Card title="Il file" icon="file">
      <dl className={`${ui.kv} ${edit.fileKv}`}>
        <dt>Percorso</dt>
        <dd className={ui.mono}>
          {video.folder}/{video.path}
        </dd>
        <dt>Formato</dt>
        <dd>{format || unread || "Non ancora letto"}</dd>
        {video.height ? (
          <>
            <dt>Qualità</dt>
            <dd>
              {qualityLabel(video.height) === `${video.height}p`
                ? `${video.height}p`
                : `${qualityLabel(video.height)} · ${video.height}p`}
            </dd>
          </>
        ) : null}
        <dt>Durata</dt>
        <dd>
          {video.duration === null
            ? (unread ?? "Non ancora letta")
            : formatDuration(video.duration)}
        </dd>
        <dt>Aggiunto</dt>
        <dd>{video.addedAt.toLocaleDateString("it-IT")}</dd>
        <dt>Browser</dt>
        <dd>{compat?.label ?? unread ?? "Non ancora letto"}</dd>
        {video.fileProblem && !video.missing && (
          <>
            <dt>Problema</dt>
            <dd>
              {fileProblemText[video.fileProblem]}
              {video.fileProblemDetail && (
                <span className={edit.fileDetail}>
                  Dettaglio tecnico: {video.fileProblemDetail}
                </span>
              )}
            </dd>
          </>
        )}
      </dl>
      {compat && !compat.ok && !video.missing && !video.fileProblem && !whyNoPlay(video)?.copy && (
        <CopyButton video={video} say={say} className={edit.fileAction} />
      )}
    </Card>
  );
}

// CopyButton asks for a copy of the video that every browser plays.
function CopyButton({
  video,
  say,
  className,
}: {
  video: AdminVideo;
  say: Say;
  className?: string;
}) {
  const [asked, setAsked] = useState(false);
  return (
    <button
      type="button"
      className={[ui.btn, ui.small, className].filter(Boolean).join(" ")}
      disabled={asked}
      onClick={() => {
        setAsked(true);
        prepareVideo(video.id)
          .then(() => say("In coda: la copia per tutti i browser arriva tra poco."))
          .catch((error: unknown) => {
            console.error(error);
            setAsked(false);
            say(failed, true);
          });
      }}
    >
      {asked ? "Copia in preparazione" : "Crea copia compatibile"}
    </button>
  );
}
