// Comments: the conversations under a video.
import { request } from "./client";
// maxCommentLength is the longest comment the server accepts.
export const maxCommentLength = 2000;
function isID(v) {
    return typeof v === "number" && Number.isInteger(v) && v > 0;
}
function parseAuthor(data, what) {
    const a = (data ?? {});
    if (!isID(a.id) || typeof a.name !== "string")
        throw new Error(`${what} author: not a person`);
    if (typeof a.avatar !== "number" || !Number.isInteger(a.avatar) || a.avatar < 0) {
        throw new Error(`${what} author: bad avatar`);
    }
    return { id: a.id, name: a.name, avatar: a.avatar };
}
export function parseComment(data, depth = 0) {
    if (typeof data !== "object" || data === null)
        throw new Error("comment: not an object");
    const d = data;
    if (!isID(d.id))
        throw new Error("comment id: not an id");
    const author = parseAuthor(d.author, "comment");
    if (typeof d.body !== "string" || d.body === "")
        throw new Error("comment body: not a text");
    const createdAt = typeof d.createdAt === "string" ? new Date(d.createdAt) : new Date(Number.NaN);
    if (Number.isNaN(createdAt.getTime()))
        throw new Error("comment createdAt: not a date");
    if (typeof d.canDelete !== "boolean")
        throw new Error("comment canDelete: not true or false");
    if (!Array.isArray(d.replies))
        throw new Error("comment replies: not a list");
    if (depth > 0 && d.replies.length > 0)
        throw new Error("comment replies: a reply has replies");
    return {
        id: d.id,
        author,
        body: d.body,
        createdAt,
        canDelete: d.canDelete,
        replies: d.replies.map((r) => parseComment(r, depth + 1)),
    };
}
export function parseComments(data) {
    if (!Array.isArray(data))
        throw new Error("comments: not a list");
    return data.map((c) => parseComment(c));
}
export async function fetchComments(videoId, signal) {
    return parseComments(await request(`/api/videos/${videoId}/comments`, { signal }));
}
// addComment writes a comment, or answers the comment parentId.
export async function addComment(videoId, body, parentId) {
    return parseComment(await request(`/api/videos/${videoId}/comments`, {
        method: "POST",
        body: parentId === undefined ? { body } : { body, parentId },
    }));
}
// deleteComment deletes a comment and its replies.
export async function deleteComment(id) {
    await request(`/api/comments/${id}`, { method: "DELETE" });
}
export function parseRecentComment(data) {
    if (typeof data !== "object" || data === null)
        throw new Error("recent comment: not an object");
    const d = data;
    if (!isID(d.id))
        throw new Error("recent comment id: not an id");
    const author = parseAuthor(d.author, "recent comment");
    if (typeof d.body !== "string" || d.body === "")
        throw new Error("recent comment body: not a text");
    const createdAt = typeof d.createdAt === "string" ? new Date(d.createdAt) : new Date(Number.NaN);
    if (Number.isNaN(createdAt.getTime()))
        throw new Error("recent comment createdAt: not a date");
    const v = (d.video ?? {});
    if (!isID(v.id) || typeof v.title !== "string" || typeof v.visible !== "boolean") {
        throw new Error("recent comment video: not a video");
    }
    if (typeof d.reply !== "boolean")
        throw new Error("recent comment reply: not true or false");
    if (typeof d.replies !== "number" || !Number.isInteger(d.replies) || d.replies < 0) {
        throw new Error("recent comment replies: not a count");
    }
    return {
        id: d.id,
        author,
        body: d.body,
        createdAt,
        video: { id: v.id, title: v.title, visible: v.visible },
        reply: d.reply,
        replies: d.replies,
    };
}
// fetchRecentComments returns a page of every comment, the newest first
// (administrators only).
export async function fetchRecentComments(limit, signal) {
    const data = await request(`/api/comments?limit=${limit}`, { signal });
    const d = (data ?? {});
    if (!Array.isArray(d.comments))
        throw new Error("recent comments: not a list");
    if (typeof d.total !== "number" || !Number.isInteger(d.total) || d.total < 0) {
        throw new Error("recent comments: bad total");
    }
    return { comments: d.comments.map(parseRecentComment), total: d.total };
}
