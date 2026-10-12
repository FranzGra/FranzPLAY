// The sources on the internet the administrator can turn on for covers
// and details of the videos. All are off until turned on.

import { ApiError, request } from "./client";

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

// Candidate is one answer to a search made by hand: picture and thumb are
// what to ask pictureURL for, "" when the answer has no picture.
export type Candidate = {
  title: string;
  date: string;
  author: string;
  picture: string;
  thumb: string;
};

export function parseCandidates(data: unknown): Candidate[] {
  if (typeof data !== "object" || data === null) throw new Error("search: not an object");
  const { results } = data as Record<string, unknown>;
  if (!Array.isArray(results)) throw new Error("search results: not a list");
  return results.map((item, i) => {
    if (typeof item !== "object" || item === null)
      throw new Error(`search result ${i}: not an object`);
    const fields = item as Record<string, unknown>;
    const text = (name: keyof Candidate): string => {
      const value = fields[name];
      if (typeof value !== "string") throw new Error(`search result ${i} ${name}: not text`);
      return value;
    };
    return {
      title: text("title"),
      date: text("date"),
      author: text("author"),
      picture: text("picture"),
      thumb: text("thumb"),
    };
  });
}

// searchOnline searches a source by hand, with the administrator's words.
export async function searchOnline(
  source: KeySource,
  words: string,
  signal?: AbortSignal,
): Promise<Candidate[]> {
  const query = new URLSearchParams({ source, q: words });
  return parseCandidates(await request(`/api/online/search?${query}`, { signal }));
}

// pictureURL is where FranzPLAY passes on a picture a search found: the
// browser never talks to the sources itself.
export function pictureURL(source: KeySource, at: string): string {
  return `/api/online/picture?${new URLSearchParams({ source, at })}`;
}

// fetchPicture downloads a picture a search found, to use it as a cover.
export async function fetchPicture(source: KeySource, at: string): Promise<Blob> {
  const response = await fetch(pictureURL(source, at));
  if (!response.ok)
    throw new ApiError(response.status, `picture: the server answered ${response.status}`);
  return response.blob();
}
