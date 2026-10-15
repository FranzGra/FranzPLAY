import { type ReactNode, useEffect, useId, useState } from "react";
import { Link, useParams } from "react-router";
import {
  type AdminVideo,
  fetchAdminVideo,
  refreshVideo,
  setVideoHidden,
} from "../../api/adminVideos";
import { ApiError } from "../../api/client";
import { fetchCategories } from "../../api/videos";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { formatDuration } from "../../lib/format";
import { PublicLinkPanel } from "../public/PublicLinkPanel";
import { CopyLink } from "../sharing/CopyLink";
import admin from "./Admin.module.css";
import styles from "./AdminVideo.module.css";
import { ClipForm } from "./ClipForm";
import { CoverForm } from "./CoverForm";
import { DetailsForm } from "./DetailsForm";
import { compatibility, qualityLabel } from "./quality";

type State =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ready"; video: AdminVideo };

// AdminVideoPage is everything the administrator can change about one
// video, in clear sections: its details, its pictures, who sees it, and
// its file. It uses the same forms the list used to open in each row.
export function AdminVideoPage() {
  const param = useParams().id ?? "";
  const id = /^\d+$/.test(param) ? Number(param) : 0;
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

  return (
    <div className={styles.page}>
      <p className={styles.back}>
        <Link to="/admin/video" className="glass">
          <Icon name="chevronLeft" size={20} />
          Video
        </Link>
      </p>
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
        <Detail video={state.video} onChanged={(video) => setState({ kind: "ready", video })} />
      )}
    </div>
  );
}

const sections = [
  { id: "informazioni", label: "Informazioni" },
  { id: "immagini", label: "Copertina e anteprima" },
  { id: "visibilita", label: "Visibilità e condivisione" },
  { id: "formato", label: "Formato" },
];

function Detail({
  video,
  onChanged,
}: {
  video: AdminVideo;
  onChanged: (video: AdminVideo) => void;
}) {
  const quality = qualityLabel(video.height);
  const meta = [
    video.uploader ? `Caricato da ${video.uploader.name}` : video.category,
    video.duration === null ? "Non ancora letto" : formatDuration(video.duration),
    quality,
  ].filter(Boolean);
  const open = !(video.hidden || video.missing || video.tooShort || video.private);

  return (
    <>
      <header className={styles.head}>
        <span className={styles.cover}>
          {video.cover ? <img src={video.cover} alt="" /> : <Icon name="play" size={28} />}
        </span>
        <div className={styles.headText}>
          <h2 className={styles.title}>{video.title}</h2>
          <p className={styles.meta}>{meta.join(" · ")}</p>
          <p className={styles.path} title={`${video.folder}/${video.path}`}>
            {video.path}
          </p>
          {open && (
            <p className={styles.meta}>
              <Link to={`/video/${video.id}`}>Guarda il video</Link>
            </p>
          )}
        </div>
      </header>

      <div className={styles.layout}>
        <nav className={styles.nav} aria-label="Sezioni del video">
          {sections.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.label}
            </a>
          ))}
        </nav>
        <div className={styles.sections}>
          <Section id="informazioni" title="Informazioni">
            <Information video={video} onChanged={onChanged} />
          </Section>
          <Section id="immagini" title="Copertina e anteprima">
            <Pictures video={video} onChanged={onChanged} />
          </Section>
          <Section id="visibilita" title="Visibilità e condivisione">
            <Visibility video={video} onChanged={onChanged} />
          </Section>
          <Section id="formato" title="Formato">
            <Format video={video} />
          </Section>
        </div>
      </div>
    </>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const heading = useId();
  return (
    <section id={id} className={`glass ${styles.section}`} aria-labelledby={heading}>
      <h3 id={heading} className={styles.sectionTitle}>
        {title}
      </h3>
      {children}
    </section>
  );
}

// useOutcome is the message under a section after an action: done, or a
// problem.
function useOutcome() {
  const [done, setDone] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const run = (work: () => Promise<void>, ok: string) => {
    setBusy(true);
    setDone("");
    setProblem("");
    work()
      .then(() => setDone(ok))
      .catch((error: unknown) => {
        console.error(error);
        setProblem("Non ci sono riuscito. Riprova tra poco.");
      })
      .finally(() => setBusy(false));
  };
  const view = (
    <>
      {problem && (
        <p role="alert" className={admin.problem}>
          {problem}
        </p>
      )}
      {done && (
        <p role="status" className={admin.done}>
          {done}
        </p>
      )}
    </>
  );
  return { busy, run, view, setDone };
}

function Information({
  video,
  onChanged,
}: {
  video: AdminVideo;
  onChanged: (video: AdminVideo) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const outcome = useOutcome();

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

  return (
    <>
      <datalist id="admin-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <dl className={styles.facts}>
        <dt>Titolo</dt>
        <dd>
          {video.title}
          {video.titleSet && <span className={admin.softBadge}>scelto da te</span>}
        </dd>
        <dt>Categoria</dt>
        <dd>
          {video.category || "Nessuna"}
          {video.categorySet && <span className={admin.softBadge}>scelta da te</span>}
        </dd>
        {video.author && (
          <>
            <dt>Autore</dt>
            <dd>{video.author}</dd>
          </>
        )}
      </dl>
      {editing ? (
        <DetailsForm
          video={video}
          onSaved={(changed) => {
            onChanged(changed);
            setEditing(false);
            outcome.setDone("Salvato. Tutti vedono titolo e categoria nuovi.");
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            className={`glass ${admin.action} ${admin.small}`}
            onClick={() => {
              outcome.setDone("");
              setEditing(true);
            }}
          >
            Modifica titolo e categoria
          </button>
        </div>
      )}
      {outcome.view}
    </>
  );
}

function Pictures({
  video,
  onChanged,
}: {
  video: AdminVideo;
  onChanged: (video: AdminVideo) => void;
}) {
  const [choosing, setChoosing] = useState<"cover" | "clip" | null>(null);
  const outcome = useOutcome();
  const coverText =
    video.coverChoice === "image"
      ? "Copertina scelta: un'immagine caricata."
      : video.coverChoice === "moment"
        ? "Copertina scelta: un momento del video."
        : "La copertina la sceglie FranzPLAY.";
  const clipText =
    video.clipChoice === "video"
      ? "Anteprima caricata da te."
      : video.clipChoice === "none"
        ? "Senza anteprima."
        : "L'anteprima la fa FranzPLAY.";
  return (
    <>
      <p className={styles.text}>{coverText}</p>
      <p className={styles.text}>{clipText}</p>
      <div className={styles.actions}>
        <button
          type="button"
          className={`glass ${admin.action} ${admin.small}`}
          aria-expanded={choosing === "cover"}
          disabled={video.missing}
          onClick={() => setChoosing(choosing === "cover" ? null : "cover")}
        >
          Cambia copertina
        </button>
        <button
          type="button"
          className={`glass ${admin.action} ${admin.small}`}
          aria-expanded={choosing === "clip"}
          disabled={video.missing}
          onClick={() => setChoosing(choosing === "clip" ? null : "clip")}
        >
          Cambia anteprima
        </button>
        <button
          type="button"
          className={`glass ${admin.action} ${admin.small}`}
          disabled={outcome.busy || video.missing}
          onClick={() =>
            outcome.run(
              () => refreshVideo(video.id),
              "In coda: copertina e anteprime arrivano tra poco.",
            )
          }
        >
          Rifai copertina e anteprime
        </button>
      </div>
      {choosing === "cover" && (
        <CoverForm
          video={video}
          onChosen={(changed) => {
            onChanged(changed);
            setChoosing(null);
            outcome.setDone("In coda: la nuova copertina arriva tra poco.");
          }}
          onClose={() => setChoosing(null)}
        />
      )}
      {choosing === "clip" && (
        <ClipForm
          video={video}
          onChosen={(changed, message) => {
            onChanged(changed);
            setChoosing(null);
            outcome.setDone(message);
          }}
          onClose={() => setChoosing(null)}
        />
      )}
      {outcome.view}
    </>
  );
}

function Visibility({
  video,
  onChanged,
}: {
  video: AdminVideo;
  onChanged: (video: AdminVideo) => void;
}) {
  const outcome = useOutcome();
  const who = video.private
    ? `Lo vede solo chi l'ha caricato${video.uploader ? ` (${video.uploader.name})` : ""} e le persone che ha scelto.`
    : video.tooShort
      ? "È più corto del minimo scelto per le cartelle: non lo vede nessuno."
      : "Lo vedono tutti quelli che hanno un account.";
  return (
    <>
      <p className={styles.text}>{who}</p>
      <div className={styles.row}>
        <p className={styles.text}>
          {video.hidden
            ? "Nascosto: non lo vede nessuno, ma tiene mi piace, commenti e posto nelle playlist."
            : "Non è nascosto."}
        </p>
        <button
          type="button"
          className={`glass ${admin.action} ${admin.small}`}
          disabled={outcome.busy}
          onClick={() =>
            outcome.run(
              async () => {
                await setVideoHidden(video.id, !video.hidden);
                onChanged({ ...video, hidden: !video.hidden });
              },
              video.hidden ? "Di nuovo visibile a tutti." : "Nascosto a tutti.",
            )
          }
        >
          {video.hidden ? "Mostra" : "Nascondi"}
        </button>
      </div>
      {outcome.view}
      {video.link !== null && (
        <div className={styles.subsection}>
          <h4 className={styles.subTitle}>Link per chi ha un account</h4>
          <CopyLink link={video.link} />
        </div>
      )}
      {!video.missing && (
        <div className={styles.subsection}>
          <PublicLinkPanel
            videoId={video.id}
            initial={video.publicLink}
            onChange={(publicLink) => onChanged({ ...video, publicLink })}
            compact
          />
        </div>
      )}
    </>
  );
}

function Format({ video }: { video: AdminVideo }) {
  const compat = compatibility(video);
  return (
    <dl className={styles.facts}>
      <dt>File</dt>
      <dd>
        {[video.format, video.videoCodec, video.audioCodec].filter(Boolean).join(" · ") || "—"}
      </dd>
      <dt>Qualità</dt>
      <dd>{qualityLabel(video.height) || "—"}</dd>
      <dt>Browser</dt>
      <dd>{compat?.label ?? "Non ancora letto"}</dd>
      <dt>Copia per tutti i browser</dt>
      <dd>{video.hasCopy ? "Pronta" : "Nessuna"}</dd>
    </dl>
  );
}
