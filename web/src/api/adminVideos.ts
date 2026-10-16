// Every video, as the administrator manages it: also the hidden ones and
// the ones whose file is not found.

import { request } from "./client";
import { parseVideo, type Video } from "./videos";

export type AdminVideo = Video & {
  folder: string; // the video folder it is in
  path: string; // inside the folder
  hidden: boolean;
  missing: boolean; // not found at the last check
  tooShort: boolean; // shorter than the minimum chosen for the folders: nobody sees it
  foundTitle: string; // the title FranzPLAY found by itself
  foundCategory: string; // the category of its folder; "" if none
  titleSet: boolean; // the title was chosen by the administrator
  categorySet: boolean; // the category was chosen by the administrator
  coverChoice: CoverChoice;
  coverSecond: number | null; // the moment chosen as cover, in seconds
  clipChoice: ClipChoice;
  videoCodec: string; // the format of the picture inside the file: "h264"; "" if not read yet
  audioCodec: string; // the format of the sound: "aac"; "" if none or not read yet
  hasCopy: boolean; // FranzPLAY made a copy every browser plays
};

// ClipChoice is where the clip on the card comes from: a "video" the
// administrator uploaded, "none" at all, or "" when FranzPLAY makes it.
export type ClipChoice = "" | "video" | "none";

// CoverChoice is where the cover comes from: an "image" the administrator
// uploaded, a "moment" of the video they chose, or "" when FranzPLAY picks.
export type CoverChoice = "" | "image" | "moment";

export type AdminShow = "" | "public" | "hidden" | "missing" | "short";

// AdminCounts are how many videos each filter shows, for the same search.
export type AdminCounts = Partial<Record<AdminShow, number>>;

export type AdminVideoList = { videos: AdminVideo[]; total: number; counts?: AdminCounts };

function parseCounts(data: unknown): AdminCounts | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const out: AdminCounts = {};
  for (const key of ["", "public", "hidden", "missing", "short"] as const) {
    const n = (data as Record<string, unknown>)[key];
    if (typeof n === "number" && Number.isInteger(n) && n >= 0) out[key] = n;
  }
  return out;
}

export function parseAdminVideo(data: unknown): AdminVideo {
  const video = parseVideo(data);
  const d = data as Record<string, unknown>;
  if (typeof d.folder !== "string" || typeof d.path !== "string") {
    throw new Error("admin video: bad folder or path");
  }
  if (
    typeof d.hidden !== "boolean" ||
    typeof d.missing !== "boolean" ||
    typeof d.tooShort !== "boolean"
  ) {
    throw new Error("admin video: bad hidden, missing or tooShort");
  }
  if (typeof d.foundTitle !== "string" || typeof d.foundCategory !== "string") {
    throw new Error("admin video: bad found title or category");
  }
  if (typeof d.titleSet !== "boolean" || typeof d.categorySet !== "boolean") {
    throw new Error("admin video: bad titleSet or categorySet");
  }
  if (d.coverChoice !== "" && d.coverChoice !== "image" && d.coverChoice !== "moment") {
    throw new Error("admin video: bad coverChoice");
  }
  if (d.clipChoice !== "" && d.clipChoice !== "video" && d.clipChoice !== "none") {
    throw new Error("admin video: bad clipChoice");
  }
  if (
    typeof d.videoCodec !== "string" ||
    typeof d.audioCodec !== "string" ||
    typeof d.hasCopy !== "boolean"
  ) {
    throw new Error("admin video: bad format");
  }
  const second = d.coverSecond;
  if (
    second !== null &&
    (typeof second !== "number" || !Number.isSafeInteger(second) || second < 0)
  ) {
    throw new Error("admin video: bad coverSecond");
  }
  return {
    ...video,
    folder: d.folder,
    path: d.path,
    hidden: d.hidden,
    missing: d.missing,
    tooShort: d.tooShort,
    foundTitle: d.foundTitle,
    foundCategory: d.foundCategory,
    titleSet: d.titleSet,
    categorySet: d.categorySet,
    coverChoice: d.coverChoice,
    coverSecond: second,
    clipChoice: d.clipChoice,
    videoCodec: d.videoCodec,
    audioCodec: d.audioCodec,
    hasCopy: d.hasCopy,
  };
}

export async function fetchAdminVideos(
  options: { q?: string; show?: AdminShow; limit: number; offset?: number },
  signal?: AbortSignal,
): Promise<AdminVideoList> {
  const params = new URLSearchParams({ limit: String(options.limit) });
  if (options.q) params.set("q", options.q);
  if (options.show) params.set("show", options.show);
  if (options.offset) params.set("offset", String(options.offset));
  const data = await request(`/api/admin/videos?${params}`, { signal });
  const d = (data ?? {}) as Record<string, unknown>;
  if (!Array.isArray(d.videos)) throw new Error("admin videos: not a list");
  if (typeof d.total !== "number" || !Number.isInteger(d.total) || d.total < 0) {
    throw new Error("admin videos: bad total");
  }
  return { videos: d.videos.map(parseAdminVideo), total: d.total, counts: parseCounts(d.counts) };
}

// setVideoHidden hides a video from everybody, or shows it again.
export async function setVideoHidden(id: number, hidden: boolean): Promise<void> {
  await request(`/api/admin/videos/${id}/hidden`, { method: "PUT", body: { hidden } });
}

// refreshVideo asks FranzPLAY to read the video again and remake its cover
// and previews.
export async function refreshVideo(id: number): Promise<void> {
  await request(`/api/admin/videos/${id}/refresh`, { method: "POST" });
}

// The limits the server checks, so mistakes show at once and in Italian.
export const maxTitle = 200;
export const maxCategory = 100;

// setVideoDetails gives a video another title and category, for everybody.
// null puts back the one FranzPLAY found; category "" means none.
export async function setVideoDetails(
  id: number,
  details: { title: string | null; category: string | null },
): Promise<void> {
  await request(`/api/admin/videos/${id}/details`, { method: "PUT", body: details });
}

// uploadCover makes image the cover of a video. The server keeps it in
// FranzPLAY's data folder; the cover is made from it shortly after.
export async function uploadCover(id: number, image: Blob): Promise<void> {
  await request(`/api/admin/videos/${id}/cover`, { method: "PUT", body: image });
}

// setCoverSecond makes a moment of the video, in seconds, its cover.
export async function setCoverSecond(id: number, second: number): Promise<void> {
  await request(`/api/admin/videos/${id}/cover-second`, { method: "PUT", body: { second } });
}

// resetCover goes back to the cover FranzPLAY picks by itself.
export async function resetCover(id: number): Promise<void> {
  await request(`/api/admin/videos/${id}/cover`, { method: "DELETE" });
}

// uploadClip makes a short video the clip on a video's card. The server
// keeps it in FranzPLAY's data folder and makes the clip from its start.
export async function uploadClip(id: number, clip: Blob): Promise<void> {
  await request(`/api/admin/videos/${id}/clip`, { method: "PUT", body: clip });
}

// remakeClip goes back to the clip FranzPLAY makes, and makes it again.
export async function remakeClip(id: number): Promise<void> {
  await request(`/api/admin/videos/${id}/clip/remake`, { method: "POST" });
}

// removeClip leaves the video's card without a clip.
export async function removeClip(id: number): Promise<void> {
  await request(`/api/admin/videos/${id}/clip`, { method: "DELETE" });
}

// fetchAdminVideo reads one video, as in the list, for its own page.
export async function fetchAdminVideo(id: number, signal?: AbortSignal): Promise<AdminVideo> {
  return parseAdminVideo(await request(`/api/admin/videos/${id}`, { signal }));
}
