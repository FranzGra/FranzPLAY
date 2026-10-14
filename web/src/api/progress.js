// Where each video was left: to start again from there, and for the
// "Continua a guardare" row of the Home.
import { request } from "./client";
import { parseVideo } from "./videos";
function seconds(value, what) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new Error(`${what}: not a number of seconds`);
    }
    return value;
}
export function parseProgress(data) {
    if (typeof data !== "object" || data === null)
        throw new Error("progress: not an object");
    const d = data;
    if (typeof d.finished !== "boolean")
        throw new Error("progress finished: not true or false");
    return { position: seconds(d.position, "progress position"), finished: d.finished };
}
export function parseWatched(data) {
    if (typeof data !== "object" || data === null)
        throw new Error("watched: not an object");
    const d = data;
    if (typeof d.finished !== "boolean")
        throw new Error("watched finished: not true or false");
    const watchedAt = typeof d.watchedAt === "string" ? new Date(d.watchedAt) : new Date(Number.NaN);
    if (Number.isNaN(watchedAt.getTime()))
        throw new Error("watched watchedAt: not a date");
    return {
        video: parseVideo(d.video),
        position: seconds(d.position, "watched position"),
        finished: d.finished,
        watchedAt,
    };
}
export function parseContinue(data) {
    if (!Array.isArray(data))
        throw new Error("continue: not a list");
    return data.map(parseWatched);
}
export function parseHistory(data) {
    if (typeof data !== "object" || data === null)
        throw new Error("history: not an object");
    const d = data;
    if (!Array.isArray(d.items))
        throw new Error("history items: not a list");
    if (typeof d.total !== "number" || !Number.isInteger(d.total) || d.total < 0) {
        throw new Error("history total: not a count");
    }
    return { items: d.items.map(parseWatched), total: d.total };
}
export async function fetchProgress(id, signal) {
    return parseProgress(await request(`/api/videos/${id}/progress`, { signal }));
}
// saveProgress tells the server where the video is. It also works while
// the page is closing.
export async function saveProgress(id, position) {
    await request(`/api/videos/${id}/progress`, {
        method: "POST",
        body: { position },
        keepalive: true,
    });
}
export async function fetchContinue(signal) {
    return parseContinue(await request("/api/continue", { signal }));
}
export async function fetchHistory({ limit, offset = 0 }, signal) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return parseHistory(await request(`/api/history?${params}`, { signal }));
}
// forgetVideo removes one video from the history: it will start again
// from the beginning.
export async function forgetVideo(id) {
    await request(`/api/history/${id}`, { method: "DELETE" });
}
// forgetHistory empties the whole history.
export async function forgetHistory() {
    await request("/api/history", { method: "DELETE" });
}
// leaveContinue takes a video out of "Continua a guardare". The history
// keeps it; watching it again puts it back.
export async function leaveContinue(id) {
    await request(`/api/continue/${id}`, { method: "DELETE" });
}
