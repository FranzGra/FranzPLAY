// The videos: list, one video, categories.

import { request } from "./client";

export type Video = {
  id: number;
  title: string;
  category: string; // "" = none
  duration: number | null; // seconds; null = not read yet
  width: number | null;
  height: number | null;
  cover: string | null; // address of the image; null = none yet
  addedAt: Date;
  playable: boolean; // every browser can play it as it is
  preview: Preview | null; // frames for the player's timeline; null = none yet
  clip: string | null; // address of the seconds that play on the card; null = none yet
  // From a file next to the video, like the .info.json of yt-dlp:
  author: string; // who published it; "" = not known
  publishedOn: Date | null; // the day it was published; null = not known
  description: string; // only when asking for one video; "" = none
};

// Preview is one image holding small frames of the video, count frames of
// width×height, one every gap seconds, columns per row.
export type Preview = {
  src: string;
  gap: number;
  count: number;
  columns: number;
  width: number;
  height: number;
};

export type VideoList = {
  videos: Video[];
  total: number; // all the matching videos, not just this page
};

export type Category = {
  name: string;
  videos: number;
};

function record(data: unknown, what: string): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`${what}: not an object`);
  }
  return data as Record<string, unknown>;
}

function count(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${what}: not a count`);
  }
  return value;
}

function optionalCount(value: unknown, what: string): number | null {
  return value === null ? null : count(value, what);
}

function parsePreview(data: unknown): Preview | null {
  if (data === null) return null;
  const p = record(data, "video preview");
  if (typeof p.src !== "string" || !p.src.startsWith("/api/previews/")) {
    throw new Error("video preview src: not a preview address");
  }
  const preview = {
    src: p.src,
    gap: count(p.gap, "video preview gap"),
    count: count(p.count, "video preview count"),
    columns: count(p.columns, "video preview columns"),
    width: count(p.width, "video preview width"),
    height: count(p.height, "video preview height"),
  };
  if (Object.entries(preview).some(([key, value]) => key !== "src" && value === 0)) {
    throw new Error("video preview: zero size");
  }
  return preview;
}

// parseVideo checks a video sent by the server, once, at the edge.
export function parseVideo(data: unknown): Video {
  const v = record(data, "video");
  const id = count(v.id, "video id");
  if (id === 0) {
    throw new Error("video id: zero");
  }
  if (typeof v.title !== "string") {
    throw new Error("video title: not text");
  }
  if (typeof v.category !== "string") {
    throw new Error("video category: not text");
  }
  if (v.cover !== null && (typeof v.cover !== "string" || !v.cover.startsWith("/api/covers/"))) {
    throw new Error("video cover: not a cover address");
  }
  if (v.clip !== null && (typeof v.clip !== "string" || !v.clip.startsWith("/api/clips/"))) {
    throw new Error("video clip: not a clip address");
  }
  if (typeof v.playable !== "boolean") {
    throw new Error("video playable: not true or false");
  }
  if (typeof v.author !== "string") {
    throw new Error("video author: not text");
  }
  if (v.description !== undefined && v.description !== null && typeof v.description !== "string") {
    throw new Error("video description: not text");
  }
  const addedAt = typeof v.addedAt === "string" ? new Date(v.addedAt) : new Date(Number.NaN);
  if (Number.isNaN(addedAt.getTime())) {
    throw new Error("video addedAt: not a date");
  }
  return {
    id,
    title: v.title,
    category: v.category,
    duration: optionalCount(v.duration, "video duration"),
    width: optionalCount(v.width, "video width"),
    height: optionalCount(v.height, "video height"),
    cover: v.cover,
    addedAt,
    playable: v.playable,
    preview: parsePreview(v.preview),
    clip: v.clip,
    author: v.author,
    publishedOn: parseDay(v.publishedOn),
    description: typeof v.description === "string" ? v.description : "",
  };
}

// parseDay reads a day like "2019-03-15", as midnight of that day where
// the person is, so it shows as the same day everywhere.
function parseDay(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) throw new Error("video publishedOn: not a day");
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error("video publishedOn: not a real day");
  }
  return date;
}

export function parseVideoList(data: unknown): VideoList {
  const l = record(data, "video list");
  if (!Array.isArray(l.videos)) {
    throw new Error("video list: videos is not a list");
  }
  return { videos: l.videos.map(parseVideo), total: count(l.total, "video list total") };
}

export function parseCategories(data: unknown): Category[] {
  if (!Array.isArray(data)) {
    throw new Error("categories: not a list");
  }
  return data.map((item) => {
    const c = record(item, "category");
    if (typeof c.name !== "string" || c.name === "") {
      throw new Error("category name: empty");
    }
    return { name: c.name, videos: count(c.videos, "category videos") };
  });
}

export type ListOptions = {
  category?: string;
  q?: string; // search words
  limit?: number;
  offset?: number;
};

export async function fetchVideos(options: ListOptions, signal?: AbortSignal): Promise<VideoList> {
  const params = new URLSearchParams();
  if (options.category) params.set("category", options.category);
  if (options.q) params.set("q", options.q);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset) params.set("offset", String(options.offset));
  const query = params.toString();
  return parseVideoList(await request(`/api/videos${query ? `?${query}` : ""}`, { signal }));
}

export async function fetchVideo(id: number, signal?: AbortSignal): Promise<Video> {
  return parseVideo(await request(`/api/videos/${id}`, { signal }));
}

export async function fetchCategories(signal?: AbortSignal): Promise<Category[]> {
  return parseCategories(await request("/api/categories", { signal }));
}

// streamURL is the address of the video file, for the player.
export function streamURL(id: number): string {
  return `/api/videos/${id}/stream`;
}

// SubtitleTrack is a subtitle file found next to a video.
export type SubtitleTrack = {
  key: string;
  lang: string; // "it", "en-US"; "" = unknown
  label: string; // "Italiano"
  src: string;
};

export function parseSubtitles(data: unknown): SubtitleTrack[] {
  if (!Array.isArray(data)) {
    throw new Error("subtitles: not a list");
  }
  return data.map((item) => {
    const s = record(item, "subtitle");
    if (typeof s.key !== "string" || s.key === "") throw new Error("subtitle key: empty");
    if (typeof s.lang !== "string") throw new Error("subtitle lang: not text");
    if (typeof s.label !== "string" || s.label === "") throw new Error("subtitle label: empty");
    if (typeof s.src !== "string" || !s.src.startsWith("/api/videos/")) {
      throw new Error("subtitle src: not a subtitle address");
    }
    return { key: s.key, lang: s.lang, label: s.label, src: s.src };
  });
}

export async function fetchSubtitles(id: number, signal?: AbortSignal): Promise<SubtitleTrack[]> {
  return parseSubtitles(await request(`/api/videos/${id}/subtitles`, { signal }));
}
