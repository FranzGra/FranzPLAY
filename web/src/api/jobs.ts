// The queue of heavy work (reading videos, covers, previews), as the
// administrator follows it.

import { request } from "./client";

export type JobKind = "probe" | "cover" | "preview" | "tracks" | "convert";

export type Job = {
  id: number;
  kind: JobKind;
  videoId: number;
  title: string;
  attempts: number;
  error: string;
  at: Date; // when it started (running) or last failed
};

export type JobsOverview = {
  waiting: number;
  retrying: number;
  done: number;
  running: Job | null;
  failed: Job[];
  failedTotal: number;
  kinds: { kind: JobKind; available: boolean }[];
};

const jobKinds: readonly JobKind[] = ["probe", "cover", "preview", "tracks", "convert"];

function isKind(k: unknown): k is JobKind {
  return jobKinds.includes(k as JobKind);
}

function count(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0)
    throw new Error(`jobs ${what}: not a count`);
  return v;
}

export function parseJob(data: unknown): Job {
  if (typeof data !== "object" || data === null) throw new Error("job: not an object");
  const d = data as Record<string, unknown>;
  if (typeof d.id !== "number" || !Number.isInteger(d.id) || d.id <= 0)
    throw new Error("job id: not an id");
  if (!isKind(d.kind)) throw new Error("job kind: unknown");
  if (typeof d.videoId !== "number" || !Number.isInteger(d.videoId) || d.videoId <= 0) {
    throw new Error("job videoId: not an id");
  }
  if (typeof d.title !== "string") throw new Error("job title: not text");
  if (typeof d.error !== "string") throw new Error("job error: not text");
  const at = typeof d.at === "string" ? new Date(d.at) : new Date(Number.NaN);
  if (Number.isNaN(at.getTime())) throw new Error("job at: not a date");
  return {
    id: d.id,
    kind: d.kind,
    videoId: d.videoId,
    title: d.title,
    attempts: count(d.attempts, "attempts"),
    error: d.error,
    at,
  };
}

export function parseJobsOverview(data: unknown): JobsOverview {
  if (typeof data !== "object" || data === null) throw new Error("jobs: not an object");
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.failed)) throw new Error("jobs failed: not a list");
  if (!Array.isArray(d.kinds)) throw new Error("jobs kinds: not a list");
  return {
    waiting: count(d.waiting, "waiting"),
    retrying: count(d.retrying, "retrying"),
    done: count(d.done, "done"),
    running: d.running === null ? null : parseJob(d.running),
    failed: d.failed.map(parseJob),
    failedTotal: count(d.failedTotal, "failedTotal"),
    kinds: d.kinds.map((k: unknown) => {
      const { kind, available } = (k ?? {}) as Record<string, unknown>;
      if (!isKind(kind) || typeof available !== "boolean") throw new Error("jobs kinds: bad entry");
      return { kind, available };
    }),
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
