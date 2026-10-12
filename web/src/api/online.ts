// The sources on the internet the administrator can turn on for covers
// and details of the videos. All are off until turned on.

import { request } from "./client";

export type OnlineSources = {
  youtube: boolean;
  tmdb: boolean;
  tpdb: boolean;
};

// OnlineStatus is what the server says: the sources, and if a key is
// saved. A key never comes back from the server.
export type OnlineStatus = OnlineSources & {
  tmdbKey: boolean;
  tpdbKey: boolean;
};

// KeySource is a source that needs a key: TMDB or ThePornDB.
export type KeySource = "tmdb" | "tpdb";

export function parseStatus(data: unknown): OnlineStatus {
  if (typeof data !== "object" || data === null) throw new Error("online: not an object");
  const fields = data as Record<string, unknown>;
  const flag = (name: keyof OnlineStatus): boolean => {
    const value = fields[name];
    if (typeof value !== "boolean") throw new Error(`online ${name}: not true or false`);
    return value;
  };
  return {
    youtube: flag("youtube"),
    tmdb: flag("tmdb"),
    tpdb: flag("tpdb"),
    tmdbKey: flag("tmdbKey"),
    tpdbKey: flag("tpdbKey"),
  };
}

export async function fetchSources(signal?: AbortSignal): Promise<OnlineStatus> {
  return parseStatus(await request("/api/online", { signal }));
}

export async function saveSources({ youtube, tmdb, tpdb }: OnlineSources): Promise<OnlineStatus> {
  return parseStatus(
    await request("/api/online", { method: "PUT", body: { youtube, tmdb, tpdb } }),
  );
}

// saveKey saves the key of a source. The server asks the source first if
// it is valid.
export async function saveKey(source: KeySource, key: string): Promise<OnlineStatus> {
  return parseStatus(await request(`/api/online/${source}-key`, { method: "PUT", body: { key } }));
}
