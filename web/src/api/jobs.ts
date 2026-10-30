// The queue of heavy work (reading videos, covers, previews), as the
// administrator follows it. The page hears of changes with the "jobs"
// server event (see events.ts) and asks GET /api/jobs again.

import { request } from "./client";

export type JobKind =
  | "probe"
  | "details"
  | "online"
  | "cover"
  | "preview"
  | "clip"
  | "tracks"
  | "translate"
  | "transcribe"
  | "convert";

// "model" is work that is not a job of the queue: a whisper model being
// downloaded, at the same time as the jobs. It has no video (id 0, videoId 0).
export type ActiveKind = JobKind | "model";

export type JobState = "pending" | "running" | "done" | "failed";

export type Job = {
  id: number;
  kind: JobKind;
  videoId: number;
  title: string;
  attempts: number;
  error: string;
  at: Date; // when it started (running) or last changed
  // The fields below come with FranzPLAY's newer servers; an older answer
  // without them gets the defaults (null, "", false).
  state: JobState | "";
  cover: string | null; // address of the video's cover
  duration: number | null; // of the video, in seconds
  urgent: boolean; // someone waits for it: it runs first
  runAfter: Date | null; // a waiting job that does not start before then; null: due
  startedAt: Date | null; // when it last started (running, done, failed)
  endedAt: Date | null; // when it ended (done, failed)
  seconds: number | null; // how long it took, or has been running
  stage: string; // a transcription: "audio", "transcribe"; a translation: "translate"; "" otherwise
  progress: number | null; // 0-100 while it runs, when it can tell
  doneSeconds: number | null; // seconds of the video handled (bytes for a download)
  totalSeconds: number | null; // seconds in all (bytes for a download)
};

// ActiveWork is a job running now, or a model download.
export type ActiveWork = Omit<Job, "kind"> & { kind: ActiveKind };

export type KindCount = {
  kind: JobKind;
  waiting: number;
  retrying: number;
  running: number;
  done: number;
  failed: number;
  recent: number; // ended in the last 24 hours, done or failed
};

export type JobsOverview = {
  waiting: number;
  retrying: number;
  done: number;
  running: Job | null; // the job the worker runs (also in active)
  failed: Job[]; // the newest first, at most 100
  failedTotal: number;
  kinds: { kind: JobKind; available: boolean }[];
  active: ActiveWork[]; // all the work going on, the oldest first
  queue: Job[]; // waiting, in the order they will run; at most 100 (waiting counts all)
  recent: Job[]; // ended in the last 24 hours, the newest first; at most 100
  recentTotal: number;
  counts: KindCount[]; // per kind, in the order they run
  // live is true when the server tells how far the work is (active, queue,
  // recent…); an older one sends only running and the counts.
  live: boolean;
};

const jobKinds: readonly JobKind[] = [
  "probe",
  "details",
  "online",
  "cover",
  "preview",
  "clip",
  "tracks",
  "translate",
  "transcribe",
  "convert",
];

const jobStates: readonly string[] = ["pending", "running", "done", "failed"];

function isKind(k: unknown): k is JobKind {
  return jobKinds.includes(k as JobKind);
}

function count(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0)
    throw new Error(`jobs ${what}: not a count`);
  return v;
}

// optionalCount is count for a field newer servers send: 0 when missing.
function optionalCount(v: unknown, what: string): number {
  return v === undefined ? 0 : count(v, what);
}

function date(v: unknown, what: string): Date {
  const d = typeof v === "string" ? new Date(v) : new Date(Number.NaN);
  if (Number.isNaN(d.getTime())) throw new Error(`${what}: not a date`);
  return d;
}

function optionalDate(v: unknown, what: string): Date | null {
  return v === undefined || v === null ? null : date(v, what);
}

function optionalNumber(v: unknown, what: string): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${what}: not a number`);
  return v;
}

// details reads the fields every job has, whatever its kind.
function details(d: Record<string, unknown>): Omit<Job, "kind" | "id" | "videoId"> {
  if (typeof d.title !== "string") throw new Error("job title: not text");
  if (typeof d.error !== "string") throw new Error("job error: not text");
  if (d.state !== undefined && !jobStates.includes(d.state as string))
    throw new Error("job state: unknown");
  if (d.cover !== undefined && d.cover !== null && typeof d.cover !== "string")
    throw new Error("job cover: not text");
  if (d.stage !== undefined && typeof d.stage !== "string") throw new Error("job stage: not text");
  return {
    title: d.title,
    attempts: count(d.attempts, "attempts"),
    error: d.error,
    at: date(d.at, "job at"),
    state: (d.state as JobState | undefined) ?? "",
    cover: (d.cover as string | null | undefined) ?? null,
    duration: optionalNumber(d.duration, "job duration"),
    urgent: d.urgent === true,
    runAfter: optionalDate(d.runAfter, "job runAfter"),
    startedAt: optionalDate(d.startedAt, "job startedAt"),
    endedAt: optionalDate(d.endedAt, "job endedAt"),
    seconds: optionalNumber(d.seconds, "job seconds"),
    stage: (d.stage as string | undefined) ?? "",
    progress: optionalNumber(d.progress, "job progress"),
    doneSeconds: optionalNumber(d.doneSeconds, "job doneSeconds"),
    totalSeconds: optionalNumber(d.totalSeconds, "job totalSeconds"),
  };
}

function isID(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

export function parseJob(data: unknown): Job {
  if (typeof data !== "object" || data === null) throw new Error("job: not an object");
  const d = data as Record<string, unknown>;
  if (!isID(d.id)) throw new Error("job id: not an id");
  if (!isKind(d.kind)) throw new Error("job kind: unknown");
  if (!isID(d.videoId)) throw new Error("job videoId: not an id");
  return { id: d.id, kind: d.kind, videoId: d.videoId, ...details(d) };
}

export function parseActiveWork(data: unknown): ActiveWork {
  if (typeof data !== "object" || data === null) throw new Error("active work: not an object");
  const d = data as Record<string, unknown>;
  if (d.kind === "model") {
    return { id: 0, kind: "model", videoId: 0, ...details(d) };
  }
  return parseJob(d);
}

function parseKindCount(data: unknown): KindCount {
  const d = (data ?? {}) as Record<string, unknown>;
  if (!isKind(d.kind)) throw new Error("jobs counts: unknown kind");
  return {
    kind: d.kind,
    waiting: count(d.waiting, "counts waiting"),
    retrying: count(d.retrying, "counts retrying"),
    running: count(d.running, "counts running"),
    done: count(d.done, "counts done"),
    failed: count(d.failed, "counts failed"),
    recent: count(d.recent, "counts recent"),
  };
}

// list reads a list newer servers send: empty when missing.
function list<T>(v: unknown, what: string, parse: (item: unknown) => T): T[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(`jobs ${what}: not a list`);
  return v.map(parse);
}

export function parseJobsOverview(data: unknown): JobsOverview {
  if (typeof data !== "object" || data === null) throw new Error("jobs: not an object");
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.failed)) throw new Error("jobs failed: not a list");
  if (!Array.isArray(d.kinds)) throw new Error("jobs kinds: not a list");
  const running = d.running === null ? null : parseJob(d.running);
  const active = list(d.active, "active", parseActiveWork);
  return {
    waiting: count(d.waiting, "waiting"),
    retrying: count(d.retrying, "retrying"),
    done: count(d.done, "done"),
    running,
    failed: d.failed.map(parseJob),
    failedTotal: count(d.failedTotal, "failedTotal"),
    kinds: d.kinds.map((k: unknown) => {
      const { kind, available } = (k ?? {}) as Record<string, unknown>;
      if (!isKind(kind) || typeof available !== "boolean") throw new Error("jobs kinds: bad entry");
      return { kind, available };
    }),
    // An older server sends only running: it is all the work going on.
    active: d.active === undefined && running ? [running] : active,
    queue: list(d.queue, "queue", parseJob),
    recent: list(d.recent, "recent", parseJob),
    recentTotal: optionalCount(d.recentTotal, "recentTotal"),
    counts: list(d.counts, "counts", parseKindCount),
    live: d.active !== undefined,
  };
}

export async function fetchJobs(signal?: AbortSignal): Promise<JobsOverview> {
  return parseJobsOverview(await request("/api/jobs", { signal }));
}

// retryJob puts a failed job back in the queue.
export async function retryJob(id: number): Promise<void> {
  await request(`/api/jobs/${id}/retry`, { method: "POST" });
}

// retryFailedJobs puts every failed job back in the queue and says how many.
export async function retryFailedJobs(): Promise<number> {
  const data = await request("/api/jobs/retry", { method: "POST" });
  const n = (data as Record<string, unknown> | null)?.count;
  return count(n, "count");
}

// remainingSeconds guesses how long a running job still takes, from how
// long it has run and how far it is; null when it cannot tell.
export function remainingSeconds(job: Pick<Job, "seconds" | "progress">): number | null {
  if (job.seconds === null || job.progress === null || job.progress <= 0 || job.progress > 100)
    return null;
  return (job.seconds * (100 - job.progress)) / job.progress;
}
