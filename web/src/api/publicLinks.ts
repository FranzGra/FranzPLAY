// Public links: one video that anybody may watch, even without an account,
// through an address like /p/{key}. Its owner makes, renews and turns off
// the link; guests read only that one video.

import { request } from "./client";
import { type Preview, parsePreview, parseSubtitles, type SubtitleTrack } from "./videos";

// isPublicKey checks the secret part of a public address, before asking.
export function isPublicKey(value: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(value);
}

// PublicVideo is what a guest sees of the video of a public link.
export type PublicVideo = {
  title: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  cover: string | null;
  preview: Preview | null;
  playable: boolean;
  fileType: string;
  copy: boolean;
  format: string;
  author: string;
  publishedOn: string | null;
  description: string | null;
  owner: string; // "" = nobody yet
  stream: string;
  // videoId is there only for a logged-in person who may open the video
  // anyway: the interface then shows its usual page.
  videoId: number | null;
};

function base(key: string): string {
  return `/api/public/${key}`;
}

function optionalNumber(value: unknown, what: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`public video ${what}: not a number`);
  }
  return value;
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string") throw new Error(`public video ${what}: not text`);
  return value;
}

function optionalText(value: unknown, what: string): string | null {
  return value === null || value === undefined ? null : text(value, what);
}

// parsePublicVideo checks the video of a public link, once, at the edge:
// every address in it must stay under the link's own.
export function parsePublicVideo(data: unknown, key: string): PublicVideo {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("public video: not an object");
  }
  const v = data as Record<string, unknown>;
  const mine = base(key);
  const stream = text(v.stream, "stream");
  const cover = optionalText(v.cover, "cover");
  if (!stream.startsWith(`${mine}/`) || (cover !== null && !cover.startsWith(`${mine}/`))) {
    throw new Error("public video: an address outside its link");
  }
  const videoId = optionalNumber(v.videoId, "videoId");
  if (typeof v.playable !== "boolean" || typeof v.copy !== "boolean") {
    throw new Error("public video: bad playable or copy");
  }
  return {
    title: text(v.title, "title"),
    duration: optionalNumber(v.duration, "duration"),
    width: optionalNumber(v.width, "width"),
    height: optionalNumber(v.height, "height"),
    cover,
    preview: parsePreview(v.preview ?? null, `${mine}/`),
    playable: v.playable,
    fileType: text(v.fileType, "fileType"),
    copy: v.copy,
    format: text(v.format, "format"),
    author: text(v.author, "author"),
    publishedOn: optionalText(v.publishedOn, "publishedOn"),
    description: optionalText(v.description, "description"),
    owner: text(v.owner, "owner"),
    stream,
    videoId: videoId !== null && Number.isInteger(videoId) && videoId > 0 ? videoId : null,
  };
}

export async function fetchPublicVideo(key: string, signal?: AbortSignal): Promise<PublicVideo> {
  return parsePublicVideo(await request(base(key), { signal }), key);
}

export async function fetchPublicSubtitles(
  key: string,
  signal?: AbortSignal,
): Promise<SubtitleTrack[]> {
  return parseSubtitles(await request(`${base(key)}/subtitles`, { signal }), `${base(key)}/`);
}

// PublicLink is the public link of one of my videos: null = none.
export type PublicLink = { link: string | null; createdAt: Date | null };

function parsePublicLink(data: unknown): PublicLink {
  if (typeof data !== "object" || data === null) throw new Error("public link: not an object");
  const { link, createdAt } = data as Record<string, unknown>;
  if (link === null || link === undefined) return { link: null, createdAt: null };
  if (typeof link !== "string" || !/^\/p\/[A-Za-z0-9_-]{22}$/.test(link)) {
    throw new Error("public link: bad link");
  }
  const at = typeof createdAt === "string" ? new Date(createdAt) : null;
  return { link, createdAt: at !== null && !Number.isNaN(at.getTime()) ? at : null };
}

export async function fetchPublicLink(videoId: number, signal?: AbortSignal): Promise<PublicLink> {
  return parsePublicLink(await request(`/api/videos/${videoId}/public-link`, { signal }));
}

// makePublicLink makes a new link for the video: an old one stops working.
export async function makePublicLink(videoId: number): Promise<PublicLink> {
  return parsePublicLink(await request(`/api/videos/${videoId}/public-link`, { method: "POST" }));
}

// revokePublicLink turns the link off: whoever has it can no longer watch.
export async function revokePublicLink(videoId: number): Promise<void> {
  await request(`/api/videos/${videoId}/public-link`, { method: "DELETE" });
}
