// The sources on the internet the administrator can turn on for covers
// and details of the videos. All are off until turned on.

import { ApiError, request } from "./client";

export type OnlineSources = {
  youtube: boolean;
  tmdb: boolean;
  tpdb: boolean;
};

// SourceName names a source on the internet.
export type SourceName = keyof OnlineSources;

// KeySource is a source that needs a key: TMDB or ThePornDB.
export type KeySource = "tmdb" | "tpdb";

// OnlineRules are the administrator's limits on the questions: the hours
// (from up to to; the same hour twice means at any time), the most videos
// a day (0: no limit), the order the sources are asked in, and if what is
// found waits for their yes.
export type OnlineRules = {
  from: number;
  to: number;
  daily: number;
  order: SourceName[];
  confirm: boolean;
};

// OnlineStatus is what the server says: the sources, if a key is saved,
// the rules, how many videos were asked about today and how many
// proposals wait for a yes. A key never comes back from the server.
export type OnlineStatus = OnlineSources & {
  tmdbKey: boolean;
  tpdbKey: boolean;
  rules: OnlineRules;
  askedToday: number;
  proposals: number;
};

const sourceNames: readonly string[] = ["youtube", "tmdb", "tpdb"];

function parseRules(data: unknown): OnlineRules {
  if (typeof data !== "object" || data === null) throw new Error("online rules: not an object");
  const fields = data as Record<string, unknown>;
  const whole = (name: string, max: number): number => {
    const value = fields[name];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
      throw new Error(`online rules ${name}: not a whole number from 0 to ${max}`);
    }
    return value;
  };
  const { order } = fields;
  if (
    !Array.isArray(order) ||
    order.length !== sourceNames.length ||
    !sourceNames.every((name) => order.includes(name))
  ) {
    throw new Error("online rules order: not every source once");
  }
  const { confirm } = fields;
  if (typeof confirm !== "boolean") throw new Error("online rules confirm: not true or false");
  return {
    from: whole("from", 23),
    to: whole("to", 23),
    daily: whole("daily", 100000),
    order,
    confirm,
  };
}

export function parseStatus(data: unknown): OnlineStatus {
  if (typeof data !== "object" || data === null) throw new Error("online: not an object");
  const fields = data as Record<string, unknown>;
  const flag = (name: keyof OnlineSources | "tmdbKey" | "tpdbKey"): boolean => {
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
    rules: parseRules(fields.rules),
    askedToday: count(fields.askedToday, "askedToday"),
    proposals: count(fields.proposals, "proposals"),
  };
}

function count(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`online ${name}: not a count`);
  }
  return value;
}

export async function fetchSources(signal?: AbortSignal): Promise<OnlineStatus> {
  return parseStatus(await request("/api/online", { signal }));
}

export async function saveSources({ youtube, tmdb, tpdb }: OnlineSources): Promise<OnlineStatus> {
  return parseStatus(
    await request("/api/online", { method: "PUT", body: { youtube, tmdb, tpdb } }),
  );
}

// saveRules saves the administrator's rules.
export async function saveRules({
  from,
  to,
  daily,
  order,
  confirm,
}: OnlineRules): Promise<OnlineStatus> {
  return parseStatus(
    await request("/api/online/rules", {
      method: "PUT",
      body: { from, to, daily, order, confirm },
    }),
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

// Proposal is what a source found for a video, waiting for the
// administrator's yes: video is the title people see now.
export type Proposal = {
  videoId: number;
  video: string;
  source: SourceName;
  title: string;
  author: string;
  date: string;
  description: string;
  picture: boolean;
};

export function parseProposals(data: unknown): Proposal[] {
  if (typeof data !== "object" || data === null) throw new Error("proposals: not an object");
  const { proposals } = data as Record<string, unknown>;
  if (!Array.isArray(proposals)) throw new Error("proposals: not a list");
  return proposals.map((item, i) => {
    if (typeof item !== "object" || item === null) throw new Error(`proposal ${i}: not an object`);
    const fields = item as Record<string, unknown>;
    const text = (name: string): string => {
      const value = fields[name];
      if (typeof value !== "string") throw new Error(`proposal ${i} ${name}: not text`);
      return value;
    };
    const { videoId, source, picture } = fields;
    if (typeof videoId !== "number" || !Number.isInteger(videoId) || videoId < 1) {
      throw new Error(`proposal ${i} videoId: not an id`);
    }
    if (typeof source !== "string" || !sourceNames.includes(source)) {
      throw new Error(`proposal ${i} source: unknown`);
    }
    if (typeof picture !== "boolean") throw new Error(`proposal ${i} picture: not true or false`);
    return {
      videoId,
      video: text("video"),
      source: source as SourceName,
      title: text("title"),
      author: text("author"),
      date: text("date"),
      description: text("description"),
      picture,
    };
  });
}

// fetchProposals lists what the sources found and waits for a yes.
export async function fetchProposals(signal?: AbortSignal): Promise<Proposal[]> {
  return parseProposals(await request("/api/online/proposals", { signal }));
}

// proposalPictureURL is the picture of a proposal, kept by FranzPLAY.
export function proposalPictureURL(videoId: number): string {
  return `/api/online/proposals/${videoId}/picture`;
}

// acceptProposal uses a proposal for its video.
export async function acceptProposal(videoId: number): Promise<void> {
  await request(`/api/online/proposals/${videoId}`, { method: "POST" });
}

// discardProposal throws a proposal away: the video keeps what it had.
export async function discardProposal(videoId: number): Promise<void> {
  await request(`/api/online/proposals/${videoId}`, { method: "DELETE" });
}
