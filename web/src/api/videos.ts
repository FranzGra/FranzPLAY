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
  if (typeof v.playable !== "boolean") {
    throw new Error("video playable: not true or false");
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
  };
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
