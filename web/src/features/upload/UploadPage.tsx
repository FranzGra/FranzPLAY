import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../api/client";
import {
  cancelUpload,
  fetchMyUploads,
  type MyUploads,
  startUpload,
  type Upload,
} from "../../api/uploads";
import { useAccount } from "../../app/auth";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { usePageTitle } from "../../components/PageTitle";
import { formatBytes } from "../../lib/format";
import { type Choice, ready, sharing } from "../sharing/audience";
import { WhoSees } from "../sharing/WhoSees";
import { videoHints } from "./hints";
import { MyVideos } from "./MyVideos";
import { alreadyThere, sendFile, UploadGone } from "./sendFile";
import styles from "./UploadPage.module.css";

// The files the server takes, as the file chooser should offer them. On a
// phone "video/*" opens the gallery.
const accept =
  "video/*,.3gp,.avi,.flv,.m2ts,.m4v,.mkv,.mov,.mp4,.mpeg,.mpg,.mts,.ogv,.ts,.webm,.wmv";

type Loaded = { kind: "loading" } | { kind: "error" } | { kind: "ready"; mine: MyUploads };

// Sending is a file on its way, from the first piece to its video.
type Sending = {
  file: File;
  upload: Upload;
  received: number;
  phase: "sending" | "failed" | "done";
  problem: string;
};

const titleOf = (name: string) => name.replace(/\.[^.]+$/, "").trim();

// UploadPage lets a person the administrator chose put a video of theirs
// on FranzPLAY. The file goes in pieces: a dropped connection costs at
// most one piece, and an upload left half way can go on later.
export function UploadPage() {
  usePageTitle("Carica un video");
  const account = useAccount();
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [sending, setSending] = useState<Sending | null>(null);
  // Changes when the list of my videos must be read again.
  const [version, setVersion] = useState(0);
  const stop = useRef<AbortController | null>(null);

  const reload = useCallback((signal?: AbortSignal) => {
    fetchMyUploads(signal)
      .then((mine) => setLoaded({ kind: "ready", mine }))
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        console.error(error);
        setLoaded({ kind: "error" });
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal);
    return () => controller.abort();
  }, [reload]);

  // Leaving the page stops the upload; the browser asks first.
  const busy = sending?.phase === "sending";
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  useEffect(() => () => stop.current?.abort(), []);

  const send = (file: File, upload: Upload) => {
    const controller = new AbortController();
    stop.current = controller;
    setSending({ file, upload, received: upload.received, phase: "sending", problem: "" });
    sendFile(file, upload, {
      signal: controller.signal,
      onProgress: (received) => setSending((s) => s && { ...s, received }),
    })
      .then((done) => {
        setSending((s) => s && { ...s, upload: done, received: done.size, phase: "done" });
        reload();
        setVersion((v) => v + 1);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setSending((s) => s && { ...s, phase: "failed", problem: explain(error) });
        reload();
      });
  };

  const cancel = (id: number) => {
    stop.current?.abort();
    setSending(null);
    cancelUpload(id)
      .catch((error: unknown) => console.error(error))
      .finally(() => reload());
  };

  if (!account.canUpload) {
    return (
      <EmptyState title="Caricare video" headingLevel={1}>
        Qui potrai mettere su FranzPLAY i tuoi video. Per farlo serve il permesso
        dell'amministratore: chiedilo a chi gestisce questo FranzPLAY.
      </EmptyState>
    );
  }
  if (loaded.kind === "loading") return <div className={styles.placeholder} aria-busy="true" />;
  if (loaded.kind === "error") {
    return (
      <EmptyState title="Caricamento non disponibile" headingLevel={1}>
        Il server non ha risposto. Ricarica la pagina tra poco.
      </EmptyState>
    );
  }
  const { space, uploads } = loaded.mine;
  const waiting = uploads.filter((u) => u.id !== sending?.upload.id);

  return (
    <div className={styles.root}>
      <h1 className={styles.heading}>
        <Icon name="upload" size={26} />
        Carica un video
      </h1>
      <SpaceBar used={space.used + space.reserved} quota={space.quota} />

      {sending ? (
        <Progress
          sending={sending}
          onRetry={() => send(sending.file, sending.upload)}
          onCancel={() => cancel(sending.upload.id)}
          onAnother={() => setSending(null)}
        />
      ) : (
        <NewUpload
          free={Math.max(0, space.quota - space.used - space.reserved)}
          waiting={waiting}
          onReady={send}
        />
      )}

      {waiting.length > 0 && (
        <section className={styles.waiting} aria-label="Caricamenti a metà">
          <h2 className={styles.subheading}>Caricamenti a metà</h2>
          <p className={styles.note}>
            Scegli di nuovo lo stesso file per continuare da dove si era fermato. Dopo 7 giorni
            senza novità vengono cancellati.
          </p>
          <ul className={`stagger ${styles.list}`}>
            {waiting.map((u) => (
              <li key={u.id}>
                <WaitingRow
                  upload={u}
                  disabled={busy}
                  onFile={(file) => send(file, u)}
                  onCancel={() => cancel(u.id)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <MyVideos version={version} onChange={() => reload()} />
    </div>
  );
}

function SpaceBar({ used, quota }: { used: number; quota: number }) {
  const share = quota > 0 ? Math.min(1, used / quota) : 1;
  return (
    <div className={styles.space}>
      <p className={styles.note}>
        Hai usato {formatBytes(used)} di {formatBytes(quota)}.
      </p>
      <div className={styles.bar} aria-hidden="true">
        <div className={styles.fill} style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

function NewUpload({
  free,
  waiting,
  onReady,
}: {
  free: number;
  waiting: Upload[];
  onReady: (file: File, upload: Upload) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [who, setWho] = useState<Choice>({ audience: "everyone", people: [] });
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState("");

  const choose = (chosen: File | undefined) => {
    setProblem("");
    setFile(chosen ?? null);
    setTitle(chosen ? titleOf(chosen.name) : "");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    if (file.size === 0) {
      setProblem("Questo file è vuoto.");
      return;
    }
    if (!ready(who)) {
      setProblem("Scegli almeno una persona che potrà vederlo.");
      return;
    }
    // The same file, already half way: it goes on from there.
    const half = waiting.find((u) => u.name === file.name && u.size === file.size);
    if (half) {
      onReady(file, half);
      return;
    }
    if (file.size > free) {
      setProblem(
        `Questo video è di ${formatBytes(file.size)}, ma ti restano ${formatBytes(free)}.`,
      );
      return;
    }
    setStarting(true);
    setProblem("");
    startUpload(file, title.trim(), sharing(who))
      .then((upload) => onReady(file, upload))
      .catch((error: unknown) => {
        console.error(error);
        setProblem(explain(error));
        setStarting(false);
      });
  };

  return (
    <form className={`glass ${styles.panel}`} onSubmit={submit} aria-label="Nuovo video">
      <label className={styles.picker}>
        <Icon name="upload" size={22} />
        <span>{file ? file.name : "Scegli un video"}</span>
        {file && <span className={styles.note}>{formatBytes(file.size)}</span>}
        <input
          type="file"
          accept={accept}
          className={styles.hiddenInput}
          onChange={(e) => choose(e.target.files?.[0])}
        />
      </label>
      {file && (
        <label className={styles.field}>
          Titolo
          <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </label>
      )}
      {file && <WhoSees choice={who} onChange={setWho} hints={videoHints} />}
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
      <button type="submit" className={styles.primary} disabled={!file || starting}>
        Carica
      </button>
    </form>
  );
}

function Progress({
  sending,
  onRetry,
  onCancel,
  onAnother,
}: {
  sending: Sending;
  onRetry: () => void;
  onCancel: () => void;
  onAnother: () => void;
}) {
  const { upload, received, phase, problem } = sending;
  const percent = Math.floor((received / upload.size) * 100);
  // Nothing more will arrive: the bar would only confuse.
  const over = problem === goneText || problem === alreadyText;
  return (
    <section className={`glass ${styles.panel}`} aria-label={upload.title}>
      <p className={styles.title}>{upload.title}</p>
      {!over && (
        <>
          <progress className={styles.progress} max={upload.size} value={received} />
          <p className={styles.note}>
            {phase === "done"
              ? `Caricato: ${formatBytes(upload.size)}.`
              : `${percent}% · ${formatBytes(received)} di ${formatBytes(upload.size)}`}
          </p>
        </>
      )}
      {phase === "sending" && (
        <p className={styles.note}>Tieni aperta questa pagina finché il caricamento non finisce.</p>
      )}
      {phase === "failed" && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
      {phase === "done" && upload.video !== undefined && (
        <p role="status" className={styles.done}>
          Fatto! FranzPLAY prepara ora copertina e anteprime.{" "}
          <Link to={`/video/${upload.video}`}>Guarda il video</Link>
        </p>
      )}
      <div className={styles.buttons}>
        {phase === "failed" && !over && (
          <button type="button" className={styles.primary} onClick={onRetry}>
            Riprova
          </button>
        )}
        {phase === "done" || over ? (
          <button type="button" className={`glass ${styles.action}`} onClick={onAnother}>
            Carica un altro video
          </button>
        ) : (
          <button type="button" className={`glass ${styles.action}`} onClick={onCancel}>
            Annulla
          </button>
        )}
      </div>
    </section>
  );
}

function WaitingRow({
  upload,
  disabled,
  onFile,
  onCancel,
}: {
  upload: Upload;
  disabled: boolean;
  onFile: (file: File) => void;
  onCancel: () => void;
}) {
  const [problem, setProblem] = useState("");
  const percent = Math.floor((upload.received / upload.size) * 100);
  const choose = (file: File | undefined) => {
    if (!file) return;
    if (file.name !== upload.name || file.size !== upload.size) {
      setProblem(`Non è lo stesso file: scegli «${upload.name}».`);
      return;
    }
    setProblem("");
    onFile(file);
  };
  return (
    <div className={`glass ${styles.row}`}>
      <div className={styles.rowText}>
        <p className={styles.title}>{upload.title}</p>
        <p className={styles.note}>
          {upload.name} · fermo al {percent}% di {formatBytes(upload.size)}
        </p>
        {problem && (
          <p role="alert" className={styles.problem}>
            {problem}
          </p>
        )}
      </div>
      <div className={styles.buttons}>
        <label className={`${styles.primary} ${disabled ? styles.off : ""}`}>
          Continua
          <input
            type="file"
            accept={accept}
            disabled={disabled}
            className={styles.hiddenInput}
            onChange={(e) => choose(e.target.files?.[0])}
          />
        </label>
        <button
          type="button"
          className={`glass ${styles.action}`}
          disabled={disabled}
          onClick={onCancel}
        >
          Annulla
        </button>
      </div>
    </div>
  );
}

const goneText =
  "Questo caricamento non c'è più sul server. Se era quasi finito guarda nel tuo canale, altrimenti ricomincia.";
const alreadyText = "Questo video c'è già su FranzPLAY.";

// explain turns what went wrong into a sentence for people.
function explain(error: unknown): string {
  if (error instanceof UploadGone) return goneText;
  if (!(error instanceof ApiError)) {
    return "La connessione si è interrotta. Quando torna, premi Riprova: si riparte da dove eri.";
  }
  switch (error.status) {
    case 403:
      return "Non puoi caricare video: lo decide l'amministratore.";
    case 400:
      if (error.message.includes("people"))
        return "Qualcuna delle persone scelte non c'è più: ricarica la pagina e scegli di nuovo.";
      if (error.message.includes("title")) return "Il titolo può avere al massimo 200 caratteri.";
      if (error.message.includes("name"))
        return "Il nome del file non va bene: rinominalo e riprova.";
      return "Questo file non è un video che FranzPLAY sa mostrare.";
    case 404:
      return goneText;
    case 409:
      if (error.message === alreadyThere) return alreadyText;
      if (error.message.includes("other uploads")) {
        return "Hai già 5 caricamenti a metà: continuane o annullane qualcuno.";
      }
      return "Il caricamento si è inceppato. Premi Riprova: si riparte da dove eri.";
    case 413:
      return "Non c'è abbastanza spazio per questo video.";
    default:
      return "Il server ha avuto un problema. Premi Riprova tra poco: si riparte da dove eri.";
  }
}
