// Likes: whether I like a video, how many people like it, and the videos
// I like.

import { request } from "./client";
import { parseVideoList, type VideoList } from "./videos";

export type Like = {
  liked: boolean;
  count: number;
};

export function parseLike(data: unknown): Like {
  if (typeof data !== "object" || data === null) throw new Error("like: not an object");
  const d = data as Record<string, unknown>;
  if (typeof d.liked !== "boolean") throw new Error("like liked: not true or false");
  if (typeof d.count !== "number" || !Number.isInteger(d.count) || d.count < 0) {
    throw new Error("like count: not a count");
  }
  return { liked: d.liked, count: d.count };
}

export async function fetchLike(id: number, signal?: AbortSignal): Promise<Like> {
  return parseLike(await request(`/api/videos/${id}/like`, { signal }));
}

// setLike says whether I like a video, and returns the like as it is now.
export async function setLike(id: number, liked: boolean): Promise<Like> {
  return parseLike(await request(`/api/videos/${id}/like`, { method: liked ? "PUT" : "DELETE" }));
}

// fetchLiked returns a page of the videos I like, the last liked first.
export async function fetchLiked(
  page: { limit: number; offset?: number },
  signal?: AbortSignal,
): Promise<VideoList> {
  const params = new URLSearchParams({ limit: String(page.limit) });
  if (page.offset) params.set("offset", String(page.offset));
  return parseVideoList(await request(`/api/likes?${params}`, { signal }));
}
