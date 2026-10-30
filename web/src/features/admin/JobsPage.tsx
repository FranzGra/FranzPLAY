import { useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../api/client";
import {
  type Job,
  type JobKind,
  type JobsOverview,
  retryFailedJobs,
  retryJob,
} from "../../api/jobs";
import { Icon } from "../../components/Icon";
import { LiveDot } from "../../components/ProgressBar";
import { formatDuration, formatSince } from "../../lib/format";
import { runningJobs, useActivity } from "./activity";
import { kindNames, kindShort, missingTool, useJobVideo } from "./jobText";
import { DownloadBox, NowJob } from "./NowJob";
import screens from "./Screens.module.css";
import { Card, Chip, Empty, Loading, Notice, n, PageHeader, Unavailable, ui, useToast } from "./ui";

export { kindNames } from "./jobText";

// JobsPage shows the heavy work FranzPLAY does by itself: what runs now,
// with its bar, what waits in the order it will run, what ended in the
// last day and what failed, with a button to try again. It follows the
// queue as it moves, and can show one kind of work only.
export function JobsPage() {
  const { jobs, download, working, overviewFailed, refresh } = useActivity();
  const [toast, say] = useToast();
  const [kind, setKind] = useState<JobKind | "">("");

  if (!jobs) return overviewFailed ? <Unavailable title="Lavori non disponibili" /> : <Loading />;

  const missing = [
    ...new Set(
      jobs.kinds
        .filter((k) => !k.available)
        .map((k) => missingTool[k.kind])
        .filter((tool) => tool !== ""),
    ),
  ];
  const mine = (job: Job) => kind === "" || job.kind === kind;
  const running = runningJobs(jobs).filter(mine);
  const queue = jobs.queue.filter(mine);
  const recent = jobs.recent.filter(mine);
  const counted = jobs.counts.find((c) => c.kind === kind);
  const waiting = kind === "" ? jobs.waiting : (counted?.waiting ?? 0);
  const retrying = kind === "" ? jobs.retrying : (counted?.retrying ?? 0);
  const recentTotal = kind === "" ? jobs.recentTotal : (counted?.recent ?? 0);

  return (
    <>
      <PageHeader
        title="Lavori"
        description="Tutto quello che FranzPLAY fa da solo per ogni video: leggere il file, preparare copertina e anteprime, copie per i browser, sottotitoli. Ne fa uno alla volta, per non rallentare chi guarda."
      />

      {missing.length > 0 && (
        <div className={screens.missingBox} role="alert">
          <Notice tone="bad" title={`Manca ${missing.join(" e ")}`}>
            FranzPLAY non lo trova su questo computer: i lavori che ne hanno bisogno aspettano
            finché non lo installi e riavvii FranzPLAY.
          </Notice>
        </div>
      )}

      <dl className={screens.jobStats}>
        <div className={screens.jobStat} data-tone={working > 0 ? "live" : undefined}>
          <dt>
            {working > 0 ? <LiveDot /> : <Icon name="check" size={16} />}
            In corso
          </dt>
          <dd>{n(working)}</dd>
        </div>
        <div className={screens.jobStat}>
          <dt>
            <Icon name="history" size={16} />
            In coda
          </dt>
          <dd>{n(jobs.waiting)}</dd>
        </div>
        <div className={screens.jobStat}>
          <dt>
            <Icon name="check" size={16} />
            Fatti
          </dt>
          <dd>{n(jobs.done)}</dd>
        </div>
        <div className={screens.jobStat} data-tone={jobs.failedTotal > 0 ? "bad" : undefined}>
          <dt>
            <Icon name="alert" size={16} />
            Non riusciti
          </dt>
          <dd>{n(jobs.failedTotal)}</dd>
        </div>
      </dl>

      {jobs.counts.length > 0 && <KindFilter jobs={jobs} kind={kind} onKind={setKind} />}

      <div className={ui.grid}>
        <div className={`${ui.stack} ${ui.span7}`}>
          <Card title="Al lavoro ora" icon="layers" tone={running.length > 0 ? "busy" : undefined}>
            {running.length > 0 ? (
              <div className={screens.nowList}>
                {running.map((job, i) => (
                  <NowJob key={job.id} job={job} waiting={i === running.length - 1 ? waiting : 0} />
                ))}
              </div>
            ) : (
              <p className={screens.quiet}>
                <Icon name="check" size={22} />
                <span>
                  <b>{kind === "" ? "Niente in corso" : `${kindNames[kind]}: niente in corso`}</b>
                  {waiting > 0
                    ? "Il prossimo lavoro parte tra un attimo."
                    : kind === ""
                      ? "FranzPLAY riposa: tutti i video sono pronti."
                      : "Nessun lavoro di questo tipo aspetta."}
                </span>
              </p>
            )}
          </Card>

          {download && kind === "" && (
            <Card title="Download" icon="download" sub="Gira accanto ai lavori" tone="busy">
              <DownloadBox download={download} />
            </Card>
          )}

          {jobs.live && <Recent jobs={recent} total={recentTotal} />}

          <Card title="Cosa sa fare" icon="settings" sub="I programmi che servono a ogni lavoro">
            <ul className={screens.kinds}>
              {jobs.kinds.map((k) => (
                <li key={k.kind}>
                  {kindNames[k.kind]}
                  {k.available ? (
                    <span className={ui.chip} data-tone="ok">
                      Pronto
                    </span>
                  ) : (
                    <span className={ui.chip} data-tone="bad">
                      Manca {missingTool[k.kind] || "un programma"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className={`${ui.stack} ${ui.span5}`}>
          <Card
            title="In coda"
            icon="history"
            sub={waiting > 0 ? "Nell'ordine in cui partiranno" : undefined}
          >
            {waiting === 0 ? (
              <p className={ui.cardText}>Nessun lavoro in coda.</p>
            ) : (
              <>
                <p className={screens.queueCount}>
                  <b>{n(waiting)}</b>
                  {waiting === 1 ? "lavoro aspetta il suo turno" : "lavori aspettano il loro turno"}
                  {retrying > 0 && (
                    <span>
                      {retrying === 1
                        ? "1 sta per essere riprovato"
                        : `${n(retrying)} stanno per essere riprovati`}
                    </span>
                  )}
                </p>
                {queue.length > 0 && (
                  <ol className={screens.jobList} aria-label="Lavori in coda">
                    {queue.map((job, i) => (
                      <li key={job.id}>
                        <QueuedJob job={job} place={i + 1} />
                      </li>
                    ))}
                  </ol>
                )}
                {queue.length > 0 && waiting > queue.length && (
                  <p className={ui.cardText}>
                    Ne mostro i primi {n(queue.length)} su {n(waiting)}.
                  </p>
                )}
              </>
            )}
          </Card>

          <Failed
            jobs={jobs}
            kind={kind}
            onDone={(text, problem) => {
              say(text, problem);
              refresh();
            }}
          />
        </div>
      </div>
      {toast}
    </>
  );
}

// KindFilter shows one kind of work only: "Tutti", "Copertina 3"… with how
// many jobs of each kind wait, run or ended in the last day.
function KindFilter({
  jobs,
  kind,
  onKind,
}: {
  jobs: JobsOverview;
  kind: JobKind | "";
  onKind: (kind: JobKind | "") => void;
}) {
  const total = (c: JobsOverview["counts"][number]) => c.waiting + c.running + c.recent + c.failed;
  const shown = jobs.counts.filter((c) => total(c) > 0 || c.kind === kind);
  if (shown.length === 0) return null;
  return (
    <fieldset className={ui.filters}>
      <legend className="visually-hidden">Quali lavori</legend>
      <button
        type="button"
        className={ui.filter}
        aria-pressed={kind === ""}
        onClick={() => onKind("")}
      >
        Tutti
      </button>
      {shown.map((c) => (
        <button
          key={c.kind}
          type="button"
          className={ui.filter}
          aria-pressed={kind === c.kind}
          onClick={() => onKind(c.kind)}
        >
          {kindShort[c.kind]} <b>{n(total(c))}</b>
        </button>
      ))}
    </fieldset>
  );
}

// JobThumb is the small picture of a job's video. A newer server sends the
// cover with the job; for an older one the video is asked.
function JobThumb({ job, size }: { job: Job; size: number }) {
  const video = useJobVideo(job.state === "" ? job.videoId : null);
  const cover = job.cover ?? video?.cover ?? null;
  const duration = job.duration ?? video?.duration ?? null;
  return (
    <Link to={`/admin/video/${job.videoId}`} className={ui.thumb} tabIndex={-1} aria-hidden="true">
      {cover ? (
        <img src={cover} alt="" loading="lazy" decoding="async" />
      ) : (
        <Icon name="film" size={size} />
      )}
      {duration ? <span className={ui.duration}>{formatDuration(duration)}</span> : null}
    </Link>
  );
}

// QueuedJob is a job waiting its turn, with its place in the queue.
function QueuedJob({ job, place }: { job: Job; place: number }) {
  const later = job.runAfter && job.runAfter.getTime() > Date.now() ? job.runAfter : null;
  return (
    <div className={screens.jobRow}>
      <span className={screens.jobPlace}>{place}</span>
      <JobThumb job={job} size={18} />
      <div className={screens.jobText}>
        <b>
          <Link to={`/admin/video/${job.videoId}`}>{job.title}</Link>
        </b>
        <span>
          {kindNames[job.kind]}
          {later &&
            ` · riprova alle ${later.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`}
        </span>
      </div>
      {job.urgent && <Chip tone="info">Prima</Chip>}
    </div>
  );
}

// tookText says how long a job took: "in 12 s", "in 4:05".
function tookText(seconds: number | null): string {
  if (seconds === null) return "";
  if (seconds < 1) return "in meno di un secondo";
  if (seconds < 60) return `in ${Math.round(seconds)} s`;
  return `in ${formatDuration(seconds)}`;
}

// Recent lists the jobs ended in the last day, the newest first: done or
// not, and how long each took.
function Recent({ jobs, total }: { jobs: Job[]; total: number }) {
  return (
    <Card title="Finiti di recente" icon="check" sub="Nelle ultime 24 ore">
      {jobs.length === 0 ? (
        <p className={ui.cardText}>Nessun lavoro finito nelle ultime 24 ore.</p>
      ) : (
        <ul className={screens.jobList} aria-label="Lavori finiti di recente">
          {jobs.map((job) => (
            <li key={job.id}>
              <div className={screens.jobRow} data-done>
                <JobThumb job={job} size={18} />
                <div className={screens.jobText}>
                  <b>
                    <Link to={`/admin/video/${job.videoId}`}>{job.title}</Link>
                  </b>
                  <span>
                    {kindNames[job.kind]}
                    {job.seconds !== null && ` · ${tookText(job.seconds)}`}
                    {` · ${formatSince(job.endedAt ?? job.at, new Date())}`}
                  </span>
                  {job.state === "failed" && job.error && (
                    <span className={screens.failError}>{job.error}</span>
                  )}
                </div>
                {job.state === "failed" ? (
                  <Chip tone="bad">Non riuscito</Chip>
                ) : (
                  <Chip tone="ok" icon="check">
                    Fatto
                  </Chip>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {total > jobs.length && (
        <p className={ui.cardText}>
          Ne mostro {n(jobs.length)} su {n(total)}.
        </p>
      )}
    </Card>
  );
}

function Failed({
  jobs,
  kind,
  onDone,
}: {
  jobs: JobsOverview;
  kind: JobKind | "";
  onDone: (text: string, problem?: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const failed = jobs.failed.filter((job) => kind === "" || job.kind === kind);

  const run = (work: () => Promise<unknown>, ok: (r: unknown) => string) => {
    setBusy(true);
    work()
      .then((r) => onDone(ok(r)))
      .catch((error: unknown) => {
        console.error(error);
        onDone(
          error instanceof ApiError && error.status === 409
            ? "Questo lavoro è già ripartito."
            : "Non sono riuscito a rimetterlo in coda. Riprova tra poco.",
          true,
        );
      })
      .finally(() => setBusy(false));
  };

  return (
    <Card
      title="Non riusciti"
      icon="alert"
      actions={
        jobs.failedTotal > 1 && (
          <button
            type="button"
            className={`${ui.btn} ${ui.small} ${ui.primary}`}
            disabled={busy}
            onClick={() =>
              run(retryFailedJobs, (r) =>
                r === 1 ? "1 lavoro rimesso in coda." : `${n(Number(r))} lavori rimessi in coda.`,
              )
            }
          >
            <Icon name="refresh" size={16} />
            Riprova tutti
          </button>
        )
      }
    >
      {failed.length === 0 ? (
        <Empty icon="check" title="Nessun lavoro non riuscito" headingLevel={3}>
          {kind === "" ? "Tutto bene." : "Nessuno di questo tipo."}
        </Empty>
      ) : (
        <ul className={screens.failList} aria-label="Lavori non riusciti">
          {failed.map((job) => (
            <li key={job.id}>
              <FailedJob
                job={job}
                busy={busy}
                onRetry={() =>
                  run(
                    () => retryJob(job.id),
                    () => "Lavoro rimesso in coda.",
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
      {kind === "" && jobs.failedTotal > jobs.failed.length && (
        <p className={ui.cardText}>
          Ne mostro {jobs.failed.length} su {n(jobs.failedTotal)}: con «Riprova tutti» ripartono
          tutti.
        </p>
      )}
    </Card>
  );
}

function FailedJob({ job, busy, onRetry }: { job: Job; busy: boolean; onRetry: () => void }) {
  return (
    <div className={screens.failRow}>
      <JobThumb job={job} size={20} />
      <div className={screens.failText}>
        <b>
          <Link to={`/admin/video/${job.videoId}`}>{job.title}</Link>
        </b>
        <span>
          {kindNames[job.kind]} · {job.attempts === 1 ? "1 tentativo" : `${job.attempts} tentativi`}{" "}
          · {formatSince(job.endedAt ?? job.at, new Date())}
        </span>
        <span className={screens.failError}>{job.error}</span>
      </div>
      <button
        type="button"
        className={`${ui.btn} ${ui.small}`}
        disabled={busy}
        onClick={onRetry}
        aria-label={`Riprova ${kindNames[job.kind]} di ${job.title}`}
      >
        Riprova
      </button>
    </div>
  );
}
