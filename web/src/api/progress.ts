// Where each video was left: to start again from there, and for the
// "Continua a guardare" row of the Home.

import { request } from "./client";
import { parseVideo, type Video } from "./videos";

export type Progress = {
  position: number; // seconds; 0 = from the start
  finished: boolean;
};

export type Started = {
  video: Video;
  position: number; // seconds
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

export function parseContinue(data: unknown): Started[] {
  if (!Array.isArray(data)) throw new Error("continue: not a list");
  return data.map((item: unknown) => {
    if (typeof item !== "object" || item === null) throw new Error("continue item: not an object");
    const d = item as Record<string, unknown>;
    return { video: parseVideo(d.video), position: seconds(d.position, "continue position") };
  });
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

export async function fetchContinue(signal?: AbortSignal): Promise<Started[]> {
  return parseContinue(await request("/api/continue", { signal }));
}
