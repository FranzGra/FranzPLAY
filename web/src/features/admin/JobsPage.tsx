import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../api/client";
import { onServerEvent } from "../../api/events";
import {
  fetchJobs,
  type Job,
  type JobKind,
  type JobsOverview,
  retryFailedJobs,
  retryJob,
} from "../../api/jobs";
import { EmptyState } from "../../components/EmptyState";
import { formatSince } from "../../lib/format";
import styles from "./Admin.module.css";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; jobs: JobsOverview };

// kindNames say what each kind of job does, in words for people.
export const kindNames: Record<JobKind, string> = {
  probe: "Lettura del video",
  details: "Informazioni dal file accanto",
  cover: "Copertina",
  preview: "Anteprime",
  tracks: "Lingue e sottotitoli",
  convert: "Copia per i browser",
};

// missingTool says which program a kind of job needs.
const missingTool: Record<JobKind, string> = {
  probe: "ffprobe",
  details: "", // needs no other program: it is always available
  cover: "ffmpeg",
  preview: "ffmpeg",
  tracks: "ffmpeg", // and ffprobe, which "probe" already names
  convert: "ffmpeg",
};

// JobsPage shows the heavy work FranzPLAY does by itself: what runs now,
// how much waits, and what failed, with a button to try again. It follows
// the queue as it moves.
export function JobsPage() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback((signal?: AbortSignal) => {
    fetchJobs(signal)
      .then((jobs) => setState({ kind: "ready", jobs }))
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        console.error(error);
        // A page already shown stays as it was.
        setState((s) => (s.kind === "ready" ? s : { kind: "error" }));
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const stop = onServerEvent("jobs", () => load(controller.signal));
    return () => {
      stop();
      controller.abort();
    };
  }, [load]);

  if (state.kind === "loading") return <div className={styles.placeholder} aria-busy="true" />;
  if (state.kind === "error") {
    return (
      <EmptyState title="Lavori non disponibili">
        Il server non ha risposto. Ricarica la pagina tra poco.
      </EmptyState>
    );
  }
  const { jobs } = state;
  const missing = [
    ...new Set(jobs.kinds.filter((k) => !k.available).map((k) => missingTool[k.kind])),
  ];

  return (
    <>
      <p className={styles.lead}>
        Qui FranzPLAY mostra il lavoro che fa da solo per ogni video: leggerne durata e formato,
        prepararne la copertina e le anteprime. Ne fa uno alla volta, per non rallentare chi guarda.
      </p>
      {missing.length > 0 && (
        <p className={`${styles.warning}`} role="alert">
          FranzPLAY non trova {missing.join(" e ")} su questo computer: i lavori che ne hanno
          bisogno aspettano finché non lo installi e riavvii FranzPLAY.
        </p>
      )}

      <dl className={styles.stats}>
        <div className={`glass ${styles.stat}`}>
          <dt>Adesso</dt>
          <dd>
            {jobs.running ? (
              <>
                {kindNames[jobs.running.kind]} di{" "}
                <Link to={`/video/${jobs.running.videoId}`}>{jobs.running.title}</Link>
              </>
            ) : (
              "Niente, riposa"
            )}
          </dd>
        </div>
        <div className={`glass ${styles.stat}`}>
          <dt>In attesa</dt>
          <dd>
            <span className={styles.number}>{jobs.waiting.toLocaleString("it-IT")}</span>
            {jobs.retrying > 0 && (
              <span className={styles.note}> ({jobs.retrying} da riprovare)</span>
            )}
          </dd>
        </div>
        <div className={`glass ${styles.stat}`}>
          <dt>Fatti</dt>
          <dd>
            <span className={styles.number}>{jobs.done.toLocaleString("it-IT")}</span>
          </dd>
        </div>
        <div className={`glass ${styles.stat}`}>
          <dt>Falliti</dt>
          <dd>
            <span className={styles.number}>{jobs.failedTotal.toLocaleString("it-IT")}</span>
          </dd>
        </div>
      </dl>

      <Failed jobs={jobs} onRetried={() => load()} />
    </>
  );
}

function Failed({ jobs, onRetried }: { jobs: JobsOverview; onRetried: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    setProblem("");
    work()
      .then(onRetried)
      .catch((error: unknown) => {
        console.error(error);
        setProblem(
          error instanceof ApiError && error.status === 409
            ? "Questo lavoro è già ripartito."
            : "Non sono riuscito a rimetterlo in coda. Riprova tra poco.",
        );
        if (error instanceof ApiError) onRetried();
      })
      .finally(() => setBusy(false));
  };

  return (
    <section aria-labelledby="failed-heading">
      <div className={styles.top}>
        <h2 id="failed-heading" className={styles.subheading}>
          Lavori falliti
        </h2>
        {jobs.failedTotal > 1 && (
          <button
            type="button"
            className={`glass ${styles.action}`}
            disabled={busy}
            onClick={() => run(retryFailedJobs)}
          >
            Riprova tutti
          </button>
        )}
      </div>
      {problem && (
        <p role="alert" className={styles.problem}>
          {problem}
        </p>
      )}
      {jobs.failed.length === 0 ? (
        <p className={styles.lead}>Nessun lavoro fallito. Tutto bene.</p>
      ) : (
        <ul className={styles.list} aria-label="Lavori falliti">
          {jobs.failed.map((job) => (
            <li key={job.id}>
              <FailedJob job={job} busy={busy} onRetry={() => run(() => retryJob(job.id))} />
            </li>
          ))}
        </ul>
      )}
      {jobs.failedTotal > jobs.failed.length && (
        <p className={styles.lead}>
          Ne mostro {jobs.failed.length} su {jobs.failedTotal.toLocaleString("it-IT")}: con «Riprova
          tutti» ripartono tutti.
        </p>
      )}
    </section>
  );
}

function FailedJob({ job, busy, onRetry }: { job: Job; busy: boolean; onRetry: () => void }) {
  return (
    <div className={`glass ${styles.person}`}>
      <div className={styles.failed}>
        <p className={styles.name}>
          <Link to={`/video/${job.videoId}`}>{job.title}</Link>
        </p>
        <p className={styles.role}>
          {kindNames[job.kind]} · {job.attempts === 1 ? "1 tentativo" : `${job.attempts} tentativi`}{" "}
          · {formatSince(job.at, new Date())}
        </p>
        <p className={styles.error}>{job.error}</p>
      </div>
      <button type="button" className={`glass ${styles.action}`} disabled={busy} onClick={onRetry}>
        Riprova
      </button>
    </div>
  );
}
