// The sources on the internet the administrator can turn on for covers
// and details of the videos. All are off until turned on.

import { request } from "./client";

export type OnlineSources = {
  youtube: boolean;
  tmdb: boolean;
};

// OnlineStatus is what the server says: the sources, and if a key is
// saved. A key never comes back from the server.
export type OnlineStatus = OnlineSources & {
  tmdbKey: boolean;
};

export function parseStatus(data: unknown): OnlineStatus {
  if (typeof data !== "object" || data === null) throw new Error("online: not an object");
  const { youtube, tmdb, tmdbKey } = data as Record<string, unknown>;
  if (typeof youtube !== "boolean") throw new Error("online youtube: not true or false");
  if (typeof tmdb !== "boolean") throw new Error("online tmdb: not true or false");
  if (typeof tmdbKey !== "boolean") throw new Error("online tmdbKey: not true or false");
  return { youtube, tmdb, tmdbKey };
}

export async function fetchSources(signal?: AbortSignal): Promise<OnlineStatus> {
  return parseStatus(await request("/api/online", { signal }));
}

export async function saveSources({ youtube, tmdb }: OnlineSources): Promise<OnlineStatus> {
  return parseStatus(await request("/api/online", { method: "PUT", body: { youtube, tmdb } }));
}

// saveTMDBKey saves TMDB's key. The server asks TMDB first if it is valid.
export async function saveTMDBKey(key: string): Promise<OnlineStatus> {
  return parseStatus(await request("/api/online/tmdb-key", { method: "PUT", body: { key } }));
}
