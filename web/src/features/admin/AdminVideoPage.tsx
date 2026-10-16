import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import {
  type AdminVideo,
  fetchAdminVideo,
  maxCategory,
  maxTitle,
  refreshVideo,
  resetCover,
  setCoverSecond,
  setVideoDetails,
  setVideoHidden,
} from "../../api/adminVideos";
import { ApiError } from "../../api/client";
import { makePublicLink, revokePublicLink } from "../../api/publicLinks";
import { fetchCategories, type Preview, prepareVideo, streamURL } from "../../api/videos";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { formatDuration } from "../../lib/format";
import { Player } from "../player/Player";
import { useSkip } from "../player/useSkip";
import { copyText } from "../share/copyText";
import { fullLink } from "../sharing/audience";
import styles from "./AdminVideo.module.css";
import { ClipForm } from "./ClipForm";
import { CoverForm } from "./CoverForm";
import { compatibility, qualityLabel } from "./quality";

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

// AdminVideoPage is one video as the administrator changes it: the video
// on the left, and on the right one form with everything about it.
// Title and category wait for Salva; the switches and the cover act at
// once and say so.
export function AdminVideoPage() {
  const param = useParams().id ?? "";
  const id = /^\d+$/.test(param) ? Number(param) : 0;
  const location = useLocation();
  const ids = idsFrom(location.state);
  const [state, setState] = useState<State>({ kind: "loading" });
  usePageTitle(state.kind === "ready" ? state.video.title : "Video");

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

  const at = ids.indexOf(id);
  const before = at > 0 ? ids[at - 1] : undefined;
  const after = at >= 0 && at < ids.length - 1 ? ids[at + 1] : undefined;

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <Link to="/admin/video" className={`glass ${styles.back}`}>
          <Icon name="chevronLeft" size={18} />
          Video
        </Link>
        {at >= 0 && ids.length > 1 && (
          <nav className={styles.steps} aria-label="Altri video">
            <StepLink to={before} ids={ids} label="Video precedente" icon="chevronLeft" />
            <span className={styles.stepCount}>
              {at + 1} di {ids.length}
            </span>
            <StepLink to={after} ids={ids} label="Video successivo" icon="chevronRight" />
          </nav>
        )}
      </div>
      {state.kind === "loading" && <div className={styles.placeholder} aria-busy="true" />}
      {state.kind === "missing" && (
        <EmptyState title="Video non trovato">Questo video non c'è più.</EmptyState>
      )}
      {state.kind === "error" && (
        <EmptyState title="Video non disponibile">
          Il server non ha risposto. Ricarica la pagina tra poco.
        </EmptyState>
      )}
      {state.kind === "ready" && (
        <Detail
          key={state.video.id}
          video={state.video}
          onChanged={(video) => setState({ kind: "ready", video })}
        />
      )}
    </div>
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
      <span className={`${styles.step} ${styles.stepOff}`} aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
    );
  }
  return (
    <Link
      to={`/admin/video/${to}`}
      state={{ ids } satisfies ListState}
      className={`glass ${styles.step}`}
      aria-label={label}
      title={label}
    >
      <Icon name={icon} size={18} />
    </Link>
  );
}

// useToast is a short message at the bottom of the page, after an action
// that took effect at once.
function useToast(): [ReactNode, (text: string, problem?: boolean) => void] {
  const [toast, setToast] = useState<{ text: string; problem: boolean; n: number } | null>(null);
  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const view = (
    <div className={styles.toastBox} aria-live="polite">
      {toast && (
        <p
          key={toast.n}
          role="status"
          className={`${styles.toast} ${toast.problem ? styles.toastBad : ""}`}
        >
          <Icon name={toast.problem ? "close" : "check"} size={16} />
          {toast.text}
        </p>
      )}
    </div>
  );
  return [view, (text, problem = false) => setToast({ text, problem, n: Date.now() })];
}

const failed = "Non ci sono riuscito. Riprova tra poco.";

function Detail({
  video,
  onChanged,
}: {
  video: AdminVideo;
  onChanged: (video: AdminVideo) => void;
}) {
  const [toast, say] = useToast();
  const quality = qualityLabel(video.height);
  const facts = [
    video.duration === null ? "" : formatDuration(video.duration),
    quality,
    [video.format, video.videoCodec.toUpperCase()].filter(Boolean).join(" · "),
  ].filter(Boolean);
  const watchable = !(video.hidden || video.missing || video.tooShort || video.private);

  return (
    <div className={styles.layout}>
      <div className={styles.media}>
        <Stage video={video} watchable={watchable} />
        {facts.length > 0 && (
          <ul className={styles.facts} aria-label="Il file">
            {facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
        <p className={styles.path} title={`${video.folder}/${video.path}`}>
          {video.folder}/{video.path}
        </p>
        {watchable && (
          <Link to={`/video/${video.id}`} className={styles.quiet}>
            Apri nella pagina del video
          </Link>
        )}
      </div>

      <div className={styles.form}>
        <h2 className="visually-hidden">{video.title}</h2>
        <Details video={video} onChanged={onChanged} />
        <Group title="Chi lo vede">
          <Audience video={video} />
          <Switch
            label="Nascosto"
            hint="Non compare nelle liste e nessuno lo apre. Mi piace e commenti restano."
            checked={video.hidden}
            onChange={async (hidden) => {
              try {
                await setVideoHidden(video.id, hidden);
                onChanged({ ...video, hidden });
                say(hidden ? "Nascosto a tutti." : "Di nuovo visibile a tutti.");
              } catch (error) {
                console.error(error);
                say(failed, true);
              }
            }}
          />
          {!video.missing && <PublicLink video={video} onChanged={onChanged} say={say} />}
        </Group>
        <Group title="Copertina">
          <Cover video={video} onChanged={onChanged} say={say} />
        </Group>
        <Group title="Formato">
          <Format video={video} say={say} />
        </Group>
      </div>
      {toast}
    </div>
  );
}

// Stage is the video itself: its cover with a play button, which starts
// the player in its place. A video nobody can open shows only the cover.
function Stage({ video, watchable }: { video: AdminVideo; watchable: boolean }) {
  const [playing, setPlaying] = useState(false);
  const { skip, onSkip } = useSkip();
  if (playing) {
    return (
      <div className={styles.stage}>
        <Player
          src={streamURL(video.id)}
          poster={video.cover}
          preview={video.preview}
          length={video.duration}
          autoPlay
          skip={skip}
          onSkip={onSkip}
        />
      </div>
    );
  }
  return (
    <div className={styles.stage}>
      {video.cover ? (
        <img className={styles.poster} src={video.cover} alt="" />
      ) : (
        <span className={styles.noPoster}>
          <Icon name="play" size={32} />
        </span>
      )}
      {watchable && video.playable && (
        <button
          type="button"
          className={styles.play}
          aria-label={`Guarda ${video.title}`}
          onClick={() => setPlaying(true)}
        >
          <Icon name="play" size={28} />
        </button>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const heading = useId();
  return (
    <section className={styles.group} aria-labelledby={heading}>
      <h2 id={heading} className={styles.groupTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

// Details are the title and the category, changed in place; a bar to
// save them comes up as soon as one differs.
function Details({
  video,
  onChanged,
}: {
  video: AdminVideo;
  onChanged: (video: AdminVideo) => void;
}) {
  const [title, setTitle] = useState(video.title);
  const [category, setCategory] = useState(video.category);
  const [categories, setCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState(false);
  const titleId = useId();
  const categoryId = useId();
  const dirty = title !== video.title || category !== video.category;

  useEffect(() => {
    const controller = new AbortController();
    fetchCategories(controller.signal)
      .then((list) => setCategories(list.map((c) => c.name)))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [saved]);

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
        onChanged({
          ...video,
          title: t,
          category: c,
          titleSet: details.title !== null,
          categorySet: details.category !== null,
        });
        setSaved(true);
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

  return (
    <form className={styles.details} onSubmit={save} aria-label="Titolo e categoria">
      <datalist id="admin-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <label htmlFor={titleId} className={styles.label}>
        Titolo
      </label>
      <textarea
        id={titleId}
        className={styles.titleInput}
        value={title}
        rows={2}
        maxLength={maxTitle}
        onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      {title.trim() !== video.foundTitle && (
        <p className={styles.hint}>
          Nome del file: «{video.foundTitle}».{" "}
          <button
            type="button"
            className={styles.textButton}
            onClick={() => setTitle(video.foundTitle)}
          >
            Usa questo
          </button>
        </p>
      )}
      <div className={styles.field}>
        <label htmlFor={categoryId} className={styles.label}>
          Categoria
        </label>
        <input
          id={categoryId}
          className={styles.input}
          value={category}
          maxLength={maxCategory}
          list="admin-categories"
          placeholder="Nessuna categoria"
          onChange={(e) => setCategory(e.target.value)}
        />
        {category.trim() !== video.foundCategory && (
          <p className={styles.hint}>
            {video.foundCategory
              ? `Dalla cartella: «${video.foundCategory}». `
              : "La cartella non ne dà una. "}
            <button
              type="button"
              className={styles.textButton}
              onClick={() => setCategory(video.foundCategory)}
            >
              Usa questa
            </button>
          </p>
        )}
      </div>
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
      {(dirty || saved) && (
        <div className={`glass ${styles.saveBar}`}>
          <span className={styles.saveText} role="status">
            {dirty ? "Modifiche non salvate" : "Salvato"}
          </span>
          {dirty && (
            <>
              <button type="button" className={styles.textButton} onClick={undo}>
                Annulla
              </button>
              <button type="submit" className={styles.primary} disabled={busy}>
                Salva
              </button>
            </>
          )}
        </div>
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
    <>
      <fieldset className={styles.segmented} disabled>
        <legend className="visually-hidden">Chi lo vede</legend>
        {options.map((o) => (
          <label key={o.id} className={styles.segment}>
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
      <p className={styles.hint}>
        {video.uploader
          ? `Lo sceglie ${video.uploader.name}, che l'ha caricato.`
          : "I video delle cartelle li vedono tutti quelli che hanno un account."}
        {video.tooShort && " È più corto del minimo scelto per le cartelle: per ora non compare."}
      </p>
    </>
  );
}

// Switch is an on/off control that acts at once.
function Switch({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => Promise<void>;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const hintId = useId();
  return (
    <label className={styles.switchRow}>
      <span className={styles.switchText}>
        <span className={styles.switchLabel}>{label}</span>
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      </span>
      <input
        type="checkbox"
        role="switch"
        className={styles.switch}
        checked={checked}
        aria-checked={checked}
        disabled={busy || disabled}
        aria-describedby={hintId}
        onChange={(e) => {
          setBusy(true);
          void onChange(e.target.checked).finally(() => setBusy(false));
        }}
      />
    </label>
  );
}

// PublicLink turns the public link on and off; on, its address is there
// to copy, and a new one can replace it.
function PublicLink({
  video,
  onChanged,
  say,
}: {
  video: AdminVideo;
  onChanged: (video: AdminVideo) => void;
  say: (text: string, problem?: boolean) => void;
}) {
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
      onChanged({ ...video, publicLink: next.link });
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
      onChanged({ ...video, publicLink: null });
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
      <Switch
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
        <div className={styles.confirm} role="alertdialog" aria-label="Disattivare il link?">
          <p className={styles.confirmText}>Disattivarlo? Chi ha il link non potrà più aprirlo.</p>
          <button type="button" className={styles.textButton} onClick={() => setAsking(false)}>
            Annulla
          </button>
          <button
            type="button"
            className={styles.danger}
            disabled={busy}
            onClick={() => void revoke()}
          >
            Disattiva
          </button>
        </div>
      )}
      {link !== null && (
        <>
          <div className={styles.linkField}>
            <input
              ref={field}
              className={styles.input}
              value={fullLink(link)}
              readOnly
              aria-label="Link pubblico"
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              className={`${styles.iconButton} ${copied ? styles.copied : ""}`}
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
          <p className={styles.hint}>
            {copied ? "Copiato. " : ""}
            <button
              type="button"
              className={styles.textButton}
              disabled={busy}
              onClick={() => void make("Nuovo link creato: quello vecchio non funziona più.")}
            >
              Genera nuovo link
            </button>
          </p>
        </>
      )}
    </>
  );
}

// frames picks a few moments of the video from the frames over its
// timeline, evenly spread, to choose the cover from.
function frames(preview: Preview, count = 7): { second: number; index: number }[] {
  const out: { second: number; index: number }[] = [];
  for (let i = 0; i < count; i++) {
    const index = Math.min(preview.count - 1, Math.round(((i + 0.5) * preview.count) / count));
    if (!out.some((f) => f.index === index)) out.push({ index, second: index * preview.gap });
  }
  return out;
}

function Cover({
  video,
  onChanged,
  say,
}: {
  video: AdminVideo;
  onChanged: (video: AdminVideo) => void;
  say: (text: string, problem?: boolean) => void;
}) {
  const [open, setOpen] = useState<"cover" | "clip" | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (work: () => Promise<void>, message: string) => {
    setBusy(true);
    try {
      await work();
      say(message);
    } catch (error) {
      console.error(error);
      say(failed, true);
    } finally {
      setBusy(false);
    }
  };
  const picks = video.preview ? frames(video.preview) : [];
  const current = video.coverChoice === "moment" ? video.coverSecond : null;

  return (
    <>
      <fieldset className={styles.thumbs} disabled={busy || video.missing}>
        <legend className="visually-hidden">Scegli la copertina</legend>
        <Thumb
          name={video.id}
          label="Quella scelta da FranzPLAY"
          checked={video.coverChoice === ""}
          onPick={() =>
            void act(async () => {
              await resetCover(video.id);
              onChanged({ ...video, coverChoice: "", coverSecond: null });
            }, "La copertina la sceglie di nuovo FranzPLAY.")
          }
        >
          {video.cover && video.coverChoice === "" ? (
            <img src={video.cover} alt="" />
          ) : (
            <span className={styles.thumbAuto}>Automatica</span>
          )}
        </Thumb>
        {video.coverChoice === "image" && video.cover && (
          <Thumb name={video.id} label="Immagine caricata" checked onPick={() => {}}>
            <img src={video.cover} alt="" />
          </Thumb>
        )}
        {video.preview &&
          picks.map((f) => (
            <Thumb
              key={f.index}
              name={video.id}
              label={`Il momento ${formatDuration(f.second)}`}
              checked={current === f.second}
              onPick={() =>
                void act(async () => {
                  await setCoverSecond(video.id, f.second);
                  onChanged({ ...video, coverChoice: "moment", coverSecond: f.second });
                }, "In coda: la nuova copertina arriva tra poco.")
              }
            >
              <FrameOf preview={video.preview as Preview} index={f.index} />
            </Thumb>
          ))}
      </fieldset>
      <p className={styles.actionsLine}>
        <button
          type="button"
          className={styles.textButton}
          aria-expanded={open === "cover"}
          disabled={video.missing}
          onClick={() => setOpen(open === "cover" ? null : "cover")}
        >
          Carica immagine o cerca
        </button>
        <button
          type="button"
          className={styles.textButton}
          disabled={busy || video.missing}
          onClick={() =>
            void act(
              () => refreshVideo(video.id),
              "In coda: copertina e anteprime arrivano tra poco.",
            )
          }
        >
          Rigenera
        </button>
      </p>
      {open === "cover" && (
        <CoverForm
          video={video}
          onChosen={(changed) => {
            onChanged(changed);
            setOpen(null);
            say("In coda: la nuova copertina arriva tra poco.");
          }}
          onClose={() => setOpen(null)}
        />
      )}
      <div className={styles.clipRow}>
        <span>
          <span className={styles.label}>Anteprima sulla scheda</span>
          <span className={styles.value}>
            {video.clipChoice === "video"
              ? "Caricata da te"
              : video.clipChoice === "none"
                ? "Senza anteprima"
                : "Fatta da FranzPLAY"}
          </span>
        </span>
        <button
          type="button"
          className={styles.textButton}
          aria-expanded={open === "clip"}
          disabled={video.missing}
          onClick={() => setOpen(open === "clip" ? null : "clip")}
        >
          Cambia anteprima
        </button>
      </div>
      {open === "clip" && (
        <ClipForm
          video={video}
          onChosen={(changed, message) => {
            onChanged(changed);
            setOpen(null);
            say(message);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

// Thumb is one cover to choose: a radio button drawn as the picture.
function Thumb({
  name,
  label,
  checked,
  onPick,
  children,
}: {
  name: number;
  label: string;
  checked: boolean;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <label className={styles.thumb} data-checked={checked}>
      <input
        type="radio"
        name={`cover-${name}`}
        className="visually-hidden"
        aria-label={label}
        checked={checked}
        onChange={onPick}
      />
      {children}
    </label>
  );
}

// FrameOf shows one small frame of the image over the timeline.
function FrameOf({ preview, index }: { preview: Preview; index: number }) {
  const column = index % preview.columns;
  const row = Math.floor(index / preview.columns);
  const rows = Math.ceil(preview.count / preview.columns);
  return (
    <span
      className={styles.frame}
      style={{
        backgroundImage: `url("${preview.src}")`,
        backgroundSize: `${preview.columns * 100}% ${rows * 100}%`,
        backgroundPosition: `${preview.columns > 1 ? (column / (preview.columns - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`,
      }}
    />
  );
}

function Format({
  video,
  say,
}: {
  video: AdminVideo;
  say: (text: string, problem?: boolean) => void;
}) {
  const compat = compatibility(video);
  const [asked, setAsked] = useState(false);
  const codecs = [video.videoCodec, video.audioCodec].filter(Boolean).join(" · ");
  return (
    <div className={styles.format}>
      <p className={styles.value}>
        {compat?.label ?? "Non ancora letto"}
        {codecs && <span className={styles.hint}> · {codecs}</span>}
      </p>
      {compat && !compat.ok && !video.missing && (
        <button
          type="button"
          className={styles.textButton}
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
      )}
    </div>
  );
}
