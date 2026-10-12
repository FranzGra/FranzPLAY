// Where each video was left: to start again from there, and for the
// "Continua a guardare" row of the Home.

import { request } from "./client";
import { parseVideo, type Video } from "./videos";

export type Progress = {
  position: number; // seconds; 0 = from the start
  finished: boolean;
};

// Watched is a video of the history (or of "Continua a guardare").
export type Watched = {
  video: Video;
  position: number; // seconds where it was left; 0 = from the start
  finished: boolean;
  watchedAt: Date;
};

export type History = {
  items: Watched[];
  total: number; // all the videos in the history, not just this page
};

function seconds(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${what}: not a number of seconds`);
  }
  return value;
}

export function parseProgress(data: unknown): Progress {
  if (typeof data !== "object" || data === null) throw new Error("progress: not an object");
  const d = data as Record<string, unknown>;
  if (typeof d.finished !== "boolean") throw new Error("progress finished: not true or false");
  return { position: seconds(d.position, "progress position"), finished: d.finished };
}

export function parseWatched(data: unknown): Watched {
  if (typeof data !== "object" || data === null) throw new Error("watched: not an object");
  const d = data as Record<string, unknown>;
  if (typeof d.finished !== "boolean") throw new Error("watched finished: not true or false");
  const watchedAt = typeof d.watchedAt === "string" ? new Date(d.watchedAt) : new Date(Number.NaN);
  if (Number.isNaN(watchedAt.getTime())) throw new Error("watched watchedAt: not a date");
  return {
    video: parseVideo(d.video),
    position: seconds(d.position, "watched position"),
    finished: d.finished,
    watchedAt,
  };
}

export function parseContinue(data: unknown): Watched[] {
  if (!Array.isArray(data)) throw new Error("continue: not a list");
  return data.map(parseWatched);
}

export function parseHistory(data: unknown): History {
  if (typeof data !== "object" || data === null) throw new Error("history: not an object");
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.items)) throw new Error("history items: not a list");
  if (typeof d.total !== "number" || !Number.isInteger(d.total) || d.total < 0) {
    throw new Error("history total: not a count");
  }
  return { items: d.items.map(parseWatched), total: d.total };
}

export async function fetchProgress(id: number, signal?: AbortSignal): Promise<Progress> {
  return parseProgress(await request(`/api/videos/${id}/progress`, { signal }));
}

// saveProgress tells the server where the video is. It also works while
// the page is closing.
export async function saveProgress(id: number, position: number): Promise<void> {
  await request(`/api/videos/${id}/progress`, {
    method: "POST",
    body: { position },
    keepalive: true,
  });
}

export async function fetchContinue(signal?: AbortSignal): Promise<Watched[]> {
  return parseContinue(await request("/api/continue", { signal }));
}

export async function fetchHistory(
  { limit, offset = 0 }: { limit: number; offset?: number },
  signal?: AbortSignal,
): Promise<History> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return parseHistory(await request(`/api/history?${params}`, { signal }));
}

// forgetVideo removes one video from the history: it will start again
// from the beginning.
export async function forgetVideo(id: number): Promise<void> {
  await request(`/api/history/${id}`, { method: "DELETE" });
}

// forgetHistory empties the whole history.
export async function forgetHistory(): Promise<void> {
  await request("/api/history", { method: "DELETE" });
}
