// The videos I uploaded: their list, a new title, who sees them, taking
// one away.
import { request } from "./client";
import { parseSharePeople } from "./people";
const isBytes = (n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
export function parseMyVideo(data) {
    if (typeof data !== "object" || data === null)
        throw new Error("my video: not an object");
    const d = data;
    if (typeof d.id !== "number" || !Number.isInteger(d.id) || d.id <= 0)
        throw new Error("my video id");
    if (typeof d.title !== "string" || d.title === "")
        throw new Error("my video title");
    if (!isBytes(d.size))
        throw new Error("my video size");
    const addedAt = typeof d.addedAt === "string" ? new Date(d.addedAt) : new Date(Number.NaN);
    if (Number.isNaN(addedAt.getTime()))
        throw new Error("my video addedAt");
    if (d.cover !== null && typeof d.cover !== "string")
        throw new Error("my video cover");
    if (typeof d.hidden !== "boolean")
        throw new Error("my video hidden");
    if (typeof d.private !== "boolean")
        throw new Error("my video private");
    const sharedWith = parseSharePeople(d.sharedWith, "my video sharedWith");
    return {
        id: d.id,
        title: d.title,
        size: d.size,
        addedAt,
        cover: d.cover,
        hidden: d.hidden,
        private: d.private,
        sharedWith,
    };
}
export async function fetchMyVideos(signal) {
    const data = await request("/api/uploads/videos", { signal });
    if (!Array.isArray(data))
        throw new Error("my videos: not a list");
    return data.map(parseMyVideo);
}
// changeMyVideo gives one of my videos a new title, or changes who sees
// it; what change leaves out stays as it is.
export async function changeMyVideo(id, change) {
    return parseMyVideo(await request(`/api/uploads/videos/${id}`, { method: "PUT", body: change }));
}
// deleteMyVideo takes one of my videos away from FranzPLAY, file included.
export async function deleteMyVideo(id) {
    await request(`/api/uploads/videos/${id}`, { method: "DELETE" });
}
