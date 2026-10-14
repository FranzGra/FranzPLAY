// Every video, as the administrator manages it: also the hidden ones and
// the ones whose file is not found.
import { request } from "./client";
import { parseVideo } from "./videos";
export function parseAdminVideo(data) {
    const video = parseVideo(data);
    const d = data;
    if (typeof d.folder !== "string" || typeof d.path !== "string") {
        throw new Error("admin video: bad folder or path");
    }
    if (typeof d.hidden !== "boolean" ||
        typeof d.missing !== "boolean" ||
        typeof d.tooShort !== "boolean") {
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
    if (typeof d.videoCodec !== "string" ||
        typeof d.audioCodec !== "string" ||
        typeof d.hasCopy !== "boolean") {
        throw new Error("admin video: bad format");
    }
    const second = d.coverSecond;
    if (second !== null &&
        (typeof second !== "number" || !Number.isSafeInteger(second) || second < 0)) {
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
export async function fetchAdminVideos(options, signal) {
    const params = new URLSearchParams({ limit: String(options.limit) });
    if (options.q)
        params.set("q", options.q);
    if (options.show)
        params.set("show", options.show);
    if (options.offset)
        params.set("offset", String(options.offset));
    const data = await request(`/api/admin/videos?${params}`, { signal });
    const d = (data ?? {});
    if (!Array.isArray(d.videos))
        throw new Error("admin videos: not a list");
    if (typeof d.total !== "number" || !Number.isInteger(d.total) || d.total < 0) {
        throw new Error("admin videos: bad total");
    }
    return { videos: d.videos.map(parseAdminVideo), total: d.total };
}
// setVideoHidden hides a video from everybody, or shows it again.
export async function setVideoHidden(id, hidden) {
    await request(`/api/admin/videos/${id}/hidden`, { method: "PUT", body: { hidden } });
}
// refreshVideo asks FranzPLAY to read the video again and remake its cover
// and previews.
export async function refreshVideo(id) {
    await request(`/api/admin/videos/${id}/refresh`, { method: "POST" });
}
// The limits the server checks, so mistakes show at once and in Italian.
export const maxTitle = 200;
export const maxCategory = 100;
// setVideoDetails gives a video another title and category, for everybody.
// null puts back the one FranzPLAY found; category "" means none.
export async function setVideoDetails(id, details) {
    await request(`/api/admin/videos/${id}/details`, { method: "PUT", body: details });
}
// uploadCover makes image the cover of a video. The server keeps it in
// FranzPLAY's data folder; the cover is made from it shortly after.
export async function uploadCover(id, image) {
    await request(`/api/admin/videos/${id}/cover`, { method: "PUT", body: image });
}
// setCoverSecond makes a moment of the video, in seconds, its cover.
export async function setCoverSecond(id, second) {
    await request(`/api/admin/videos/${id}/cover-second`, { method: "PUT", body: { second } });
}
// resetCover goes back to the cover FranzPLAY picks by itself.
export async function resetCover(id) {
    await request(`/api/admin/videos/${id}/cover`, { method: "DELETE" });
}
// uploadClip makes a short video the clip on a video's card. The server
// keeps it in FranzPLAY's data folder and makes the clip from its start.
export async function uploadClip(id, clip) {
    await request(`/api/admin/videos/${id}/clip`, { method: "PUT", body: clip });
}
// remakeClip goes back to the clip FranzPLAY makes, and makes it again.
export async function remakeClip(id) {
    await request(`/api/admin/videos/${id}/clip/remake`, { method: "POST" });
}
// removeClip leaves the video's card without a clip.
export async function removeClip(id) {
    await request(`/api/admin/videos/${id}/clip`, { method: "DELETE" });
}
