// The videos: list, one video, categories.

import { request } from "./client";
import { parseSharePeople, type SharePerson } from "./people";

export type Video = {
  id: number;
  title: string;
  category: string; // "" = none
  duration: number | null; // seconds; null = not read yet
  width: number | null;
  height: number | null;
  cover: string | null; // address of the image; null = none yet
  addedAt: Date;
  playable: boolean; // every browser can play it: as it is, or its copy
  // fileType describes the file for canPlayType, like
  // 'video/webm; codecs="vp09.00.40.08, opus"'; "" = no browser is worth asking.
  fileType: string;
  copy: boolean; // a copy for every device is ready
  preview: Preview | null; // frames for the player's timeline; null = none yet
  clip: string | null; // address of the seconds that play on the card; null = none yet
  clipHD: string | null; // the same seconds, sharper, for a good connection; null = none yet
  format: string; // the kind of file, from its name: "MP4", "MKV"; "" = none
  likes: number; // how many people like it
  private: boolean; // only the person who uploaded it sees it, and the people they chose
  uploader: Person | null; // who uploaded it from the browser; null = from a video folder
  // owner is whose video it is, shown under the title: the uploader, or for
  // a video from a folder the main administrator. Only when asking for one
  // video; null otherwise.
  owner: Owner | null;
  // sharedWith are the people a private video is shared with: only for one
  // video, and only for the person who uploaded it; [] otherwise.
  sharedWith: SharePerson[];
  // From a file next to the video, like the .info.json of yt-dlp:
  author: string; // who published it; "" = not known
  publishedOn: Date | null; // the day it was published; null = not known
  description: string; // only when asking for one video; "" = none
};

// Person is someone on FranzPLAY, as a video names them.
export type Person = { id: number; name: string };

function parsePerson(value: unknown, what = "video uploader"): Person | null {
  if (value === null || value === undefined) return null;
  const p = record(value, what);
  const id = count(p.id, `${what} id`);
  if (id === 0) throw new Error(`${what} id: zero`);
  if (typeof p.name !== "string" || p.name === "") throw new Error(`${what} name: not a name`);
  return { id, name: p.name };
}

// Owner is the person a video belongs to, with their profile photo.
export type Owner = Person & { avatar: number }; // avatar: version of the photo, 0 = none

function parseOwner(value: unknown): Owner | null {
  if (value === null || value === undefined) return null;
  const person = parsePerson(value, "video owner");
  if (person === null) return null;
  return { ...person, avatar: count(record(value, "video owner").avatar, "video owner avatar") };
}

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
  color: string; // chosen by the administrator, like "#2997ff"; "" = none
  image: string | null; // address of its image; null = none
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
  const clipHD = v.clipHD ?? null;
  if (clipHD !== null && (typeof clipHD !== "string" || !clipHD.startsWith("/api/clips-hd/"))) {
    throw new Error("video clipHD: not a sharp clip address");
  }
  if (typeof v.playable !== "boolean") {
    throw new Error("video playable: not true or false");
  }
  if (typeof v.fileType !== "string" || v.fileType.length > 200) {
    throw new Error("video fileType: not a file type");
  }
  if (typeof v.copy !== "boolean") {
    throw new Error("video copy: not true or false");
  }
  // A short name of letters and digits, as the server takes it from the
  // file name: anything else is not a kind of file.
  if (typeof v.format !== "string" || !/^[A-Z0-9]{0,10}$/.test(v.format)) {
    throw new Error("video format: not a kind of file");
  }
  if (typeof v.private !== "boolean") {
    throw new Error("video private: not true or false");
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
    fileType: v.fileType,
    copy: v.copy,
    preview: parsePreview(v.preview),
    clip: v.clip,
    clipHD,
    format: v.format,
    likes: count(v.likes, "video likes"),
    private: v.private,
    uploader: parsePerson(v.uploader),
    owner: parseOwner(v.owner),
    sharedWith:
      v.sharedWith === undefined ? [] : parseSharePeople(v.sharedWith, "video sharedWith"),
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
    if (typeof c.color !== "string" || (c.color !== "" && !/^#[0-9a-f]{6}$/.test(c.color))) {
      throw new Error("category color: not a color");
    }
    if (
      c.image !== null &&
      (typeof c.image !== "string" || !c.image.startsWith("/api/category-images/"))
    ) {
      throw new Error("category image: not an image address");
    }
    return {
      name: c.name,
      videos: count(c.videos, "category videos"),
      color: c.color,
      image: c.image,
    };
  });
}

export type ListOptions = {
  category?: string;
  uploader?: number; // only the videos this person uploaded
  shared?: boolean; // only the private videos shared with me
  q?: string; // search words
  // seed mixes the videos instead of showing the newest first; the same
  // seed gives the same order, so pages follow on without repeats.
  seed?: number;
  limit?: number;
  offset?: number;
};

export async function fetchVideos(options: ListOptions, signal?: AbortSignal): Promise<VideoList> {
  const params = new URLSearchParams();
  if (options.category) params.set("category", options.category);
  if (options.uploader) params.set("uploader", String(options.uploader));
  if (options.shared) params.set("shared", "1");
  if (options.q) params.set("q", options.q);
  if (options.seed) {
    params.set("order", "random");
    params.set("seed", String(options.seed));
  }
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

// streamURL is the address of the video file, for the player: the copy
// made for every device when there is one, the file itself if original.
export function streamURL(id: number, original = false): string {
  return `/api/videos/${id}/stream${original ? "?original=1" : ""}`;
}

// playsFileItself reports whether this browser can play the file of a
// video as it is: then it gets the file at its full quality, not the copy
// made for every device. canPlayType answers "probably" only when it
// knows the box and every format inside.
export function playsFileItself(video: Video, canPlayType: (type: string) => string): boolean {
  return video.fileType !== "" && canPlayType(video.fileType) === "probably";
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

// CopyState says where the copy of a video for every device is: made
// (ready), in the queue (waiting), being made (working), not possible
// (failed), or not planned, because the file should play as it is (none).
export type CopyState = "ready" | "waiting" | "working" | "failed" | "none";

const copyStates: readonly CopyState[] = ["ready", "waiting", "working", "failed", "none"];

// CopyProgress is where the copy is, and while it is being made how much
// of it is done, 0 to 99 (null when not known).
export type CopyProgress = { state: CopyState; percent: number | null };

export function parseCopyProgress(data: unknown): CopyProgress {
  const d = (data ?? {}) as { state?: unknown; percent?: unknown };
  const state = copyStates.find((s) => s === d.state);
  if (!state) throw new Error("copy state: not a known state");
  const percent = d.percent ?? null;
  if (
    percent !== null &&
    (typeof percent !== "number" || !Number.isInteger(percent) || percent < 0 || percent > 100)
  ) {
    throw new Error("copy percent: not a percentage");
  }
  return { state, percent };
}

// prepareVideo tells the server this browser cannot play a video: its copy
// for every device goes before every other job. It answers where the copy
// is, and asking again only answers that.
export async function prepareVideo(id: number): Promise<CopyProgress> {
  return parseCopyProgress(await request(`/api/videos/${id}/prepare`, { method: "POST" }));
}
