// Where the clips on the cards start and how long they last, for the whole
// site: the administrator's choice, used by the clips made from now on.

import { request } from "./client";

export type ClipSettings = {
  // startPercent is where every clip starts, in percent of the video;
  // 0 is automatic: a few moments spread over the video, as always.
  startPercent: number;
  seconds: number; // how long every clip lasts
};

// The bounds the server accepts.
export const maxClipStartPercent = 95;
export const minClipSeconds = 2;
export const maxClipSeconds = 30;
export const defaultClipSeconds = 6;

export function parseClipSettings(data: unknown): ClipSettings {
  if (typeof data !== "object" || data === null) throw new Error("clip settings: not an object");
  const d = data as Record<string, unknown>;
  const { startPercent, seconds } = d;
  if (
    typeof startPercent !== "number" ||
    !Number.isInteger(startPercent) ||
    startPercent < 0 ||
    startPercent > maxClipStartPercent
  ) {
    throw new Error("clip settings: bad startPercent");
  }
  if (
    typeof seconds !== "number" ||
    !Number.isInteger(seconds) ||
    seconds < minClipSeconds ||
    seconds > maxClipSeconds
  ) {
    throw new Error("clip settings: bad seconds");
  }
  return { startPercent, seconds };
}

export async function fetchClipSettings(signal?: AbortSignal): Promise<ClipSettings> {
  return parseClipSettings(await request("/api/admin/clip-settings", { signal }));
}

export async function saveClipSettings(settings: ClipSettings): Promise<ClipSettings> {
  return parseClipSettings(
    await request("/api/admin/clip-settings", { method: "PUT", body: settings }),
  );
}
