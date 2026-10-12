// The sources on the internet the administrator can turn on for covers
// and details of the videos. All are off until turned on.

import { request } from "./client";

export type OnlineSources = {
  youtube: boolean;
};

export function parseSources(data: unknown): OnlineSources {
  if (typeof data !== "object" || data === null) throw new Error("online: not an object");
  const { youtube } = data as Record<string, unknown>;
  if (typeof youtube !== "boolean") throw new Error("online youtube: not true or false");
  return { youtube };
}

export async function fetchSources(signal?: AbortSignal): Promise<OnlineSources> {
  return parseSources(await request("/api/online", { signal }));
}

export async function saveSources(sources: OnlineSources): Promise<OnlineSources> {
  return parseSources(await request("/api/online", { method: "PUT", body: sources }));
}
