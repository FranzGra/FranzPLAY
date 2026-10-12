// Every video, as the administrator manages it: also the hidden ones and
// the ones whose file is not found.

import { request } from "./client";
import { parseVideo, type Video } from "./videos";

export type AdminVideo = Video & {
  folder: string; // the video folder it is in
  path: string; // inside the folder
  hidden: boolean;
  missing: boolean; // not found at the last check
  foundTitle: string; // the title FranzPLAY found by itself
  foundCategory: string; // the category of its folder; "" if none
  titleSet: boolean; // the title was chosen by the administrator
  categorySet: boolean; // the category was chosen by the administrator
};

export type AdminShow = "" | "hidden" | "missing";

export type AdminVideoList = { videos: AdminVideo[]; total: number };

export function parseAdminVideo(data: unknown): AdminVideo {
  const video = parseVideo(data);
  const d = data as Record<string, unknown>;
  if (typeof d.folder !== "string" || typeof d.path !== "string") {
    throw new Error("admin video: bad folder or path");
  }
  if (typeof d.hidden !== "boolean" || typeof d.missing !== "boolean") {
    throw new Error("admin video: bad hidden or missing");
  }
  if (typeof d.foundTitle !== "string" || typeof d.foundCategory !== "string") {
    throw new Error("admin video: bad found title or category");
  }
  if (typeof d.titleSet !== "boolean" || typeof d.categorySet !== "boolean") {
    throw new Error("admin video: bad titleSet or categorySet");
  }
  return {
    ...video,
    folder: d.folder,
    path: d.path,
    hidden: d.hidden,
    missing: d.missing,
    foundTitle: d.foundTitle,
    foundCategory: d.foundCategory,
    titleSet: d.titleSet,
    categorySet: d.categorySet,
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
  return { videos: d.videos.map(parseAdminVideo), total: d.total };
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
