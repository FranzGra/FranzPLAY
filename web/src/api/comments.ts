// Comments: the conversations under a video.

import { request } from "./client";

export type Author = {
  id: number;
  name: string;
};

export type Comment = {
  id: number;
  author: Author;
  body: string;
  createdAt: Date;
  // canDelete says whether the person looking may delete it.
  canDelete: boolean;
  // replies are the answers, oldest first; a reply has none.
  replies: Comment[];
};

// maxCommentLength is the longest comment the server accepts.
export const maxCommentLength = 2000;

function isID(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

export function parseComment(data: unknown, depth = 0): Comment {
  if (typeof data !== "object" || data === null) throw new Error("comment: not an object");
  const d = data as Record<string, unknown>;
  if (!isID(d.id)) throw new Error("comment id: not an id");
  if (typeof d.author !== "object" || d.author === null) throw new Error("comment author: missing");
  const a = d.author as Record<string, unknown>;
  if (!isID(a.id) || typeof a.name !== "string") throw new Error("comment author: not a person");
  if (typeof d.body !== "string" || d.body === "") throw new Error("comment body: not a text");
  const createdAt = typeof d.createdAt === "string" ? new Date(d.createdAt) : new Date(Number.NaN);
  if (Number.isNaN(createdAt.getTime())) throw new Error("comment createdAt: not a date");
  if (typeof d.canDelete !== "boolean") throw new Error("comment canDelete: not true or false");
  if (!Array.isArray(d.replies)) throw new Error("comment replies: not a list");
  if (depth > 0 && d.replies.length > 0) throw new Error("comment replies: a reply has replies");
  return {
    id: d.id,
    author: { id: a.id, name: a.name },
    body: d.body,
    createdAt,
    canDelete: d.canDelete,
    replies: d.replies.map((r) => parseComment(r, depth + 1)),
  };
}

export function parseComments(data: unknown): Comment[] {
  if (!Array.isArray(data)) throw new Error("comments: not a list");
  return data.map((c) => parseComment(c));
}

export async function fetchComments(videoId: number, signal?: AbortSignal): Promise<Comment[]> {
  return parseComments(await request(`/api/videos/${videoId}/comments`, { signal }));
}

// addComment writes a comment, or answers the comment parentId.
export async function addComment(
  videoId: number,
  body: string,
  parentId?: number,
): Promise<Comment> {
  return parseComment(
    await request(`/api/videos/${videoId}/comments`, {
      method: "POST",
      body: parentId === undefined ? { body } : { body, parentId },
    }),
  );
}

// deleteComment deletes a comment and its replies.
export async function deleteComment(id: number): Promise<void> {
  await request(`/api/comments/${id}`, { method: "DELETE" });
}

// RecentComment is a comment in the administrator's list of every comment.
export type RecentComment = {
  id: number;
  author: Author;
  body: string;
  createdAt: Date;
  video: { id: number; title: string; visible: boolean };
  reply: boolean; // it answers another comment
  replies: number; // answers it has: they go when it goes
};

export function parseRecentComment(data: unknown): RecentComment {
  if (typeof data !== "object" || data === null) throw new Error("recent comment: not an object");
  const d = data as Record<string, unknown>;
  if (!isID(d.id)) throw new Error("recent comment id: not an id");
  const a = (d.author ?? {}) as Record<string, unknown>;
  if (!isID(a.id) || typeof a.name !== "string")
    throw new Error("recent comment author: not a person");
  if (typeof d.body !== "string" || d.body === "")
    throw new Error("recent comment body: not a text");
  const createdAt = typeof d.createdAt === "string" ? new Date(d.createdAt) : new Date(Number.NaN);
  if (Number.isNaN(createdAt.getTime())) throw new Error("recent comment createdAt: not a date");
  const v = (d.video ?? {}) as Record<string, unknown>;
  if (!isID(v.id) || typeof v.title !== "string" || typeof v.visible !== "boolean") {
    throw new Error("recent comment video: not a video");
  }
  if (typeof d.reply !== "boolean") throw new Error("recent comment reply: not true or false");
  if (typeof d.replies !== "number" || !Number.isInteger(d.replies) || d.replies < 0) {
    throw new Error("recent comment replies: not a count");
  }
  return {
    id: d.id,
    author: { id: a.id, name: a.name },
    body: d.body,
    createdAt,
    video: { id: v.id, title: v.title, visible: v.visible },
    reply: d.reply,
    replies: d.replies,
  };
}

// fetchRecentComments returns a page of every comment, the newest first
// (administrators only).
export async function fetchRecentComments(
  limit: number,
  signal?: AbortSignal,
): Promise<{ comments: RecentComment[]; total: number }> {
  const data = await request(`/api/comments?limit=${limit}`, { signal });
  const d = (data ?? {}) as Record<string, unknown>;
  if (!Array.isArray(d.comments)) throw new Error("recent comments: not a list");
  if (typeof d.total !== "number" || !Number.isInteger(d.total) || d.total < 0) {
    throw new Error("recent comments: bad total");
  }
  return { comments: d.comments.map(parseRecentComment), total: d.total };
}
