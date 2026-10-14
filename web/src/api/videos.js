// The videos: list, one video, categories.
import { request } from "./client";
import { parseSharePeople } from "./people";
function parsePerson(value, what = "video uploader") {
    if (value === null || value === undefined)
        return null;
    const p = record(value, what);
    const id = count(p.id, `${what} id`);
    if (id === 0)
        throw new Error(`${what} id: zero`);
    if (typeof p.name !== "string" || p.name === "")
        throw new Error(`${what} name: not a name`);
    return { id, name: p.name };
}
function parseOwner(value) {
    if (value === null || value === undefined)
        return null;
    const person = parsePerson(value, "video owner");
    if (person === null)
        return null;
    return { ...person, avatar: count(record(value, "video owner").avatar, "video owner avatar") };
}
function record(data, what) {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
        throw new Error(`${what}: not an object`);
    }
    return data;
}
function count(value, what) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new Error(`${what}: not a count`);
    }
    return value;
}
function optionalCount(value, what) {
    return value === null ? null : count(value, what);
}
function parsePreview(data) {
    if (data === null)
        return null;
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
export function parseVideo(data) {
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
        sharedWith: v.sharedWith === undefined ? [] : parseSharePeople(v.sharedWith, "video sharedWith"),
        author: v.author,
        publishedOn: parseDay(v.publishedOn),
        description: typeof v.description === "string" ? v.description : "",
    };
}
// parseDay reads a day like "2019-03-15", as midnight of that day where
// the person is, so it shows as the same day everywhere.
function parseDay(value) {
    if (value === null || value === undefined)
        return null;
    const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
    if (!match)
        throw new Error("video publishedOn: not a day");
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(year, month - 1, day);
    if (date.getMonth() !== month - 1 || date.getDate() !== day) {
        throw new Error("video publishedOn: not a real day");
    }
    return date;
}
export function parseVideoList(data) {
    const l = record(data, "video list");
    if (!Array.isArray(l.videos)) {
        throw new Error("video list: videos is not a list");
    }
    return { videos: l.videos.map(parseVideo), total: count(l.total, "video list total") };
}
export function parseCategories(data) {
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
        if (c.image !== null &&
            (typeof c.image !== "string" || !c.image.startsWith("/api/category-images/"))) {
            throw new Error("category image: not an image address");
        }
        const cover = c.cover ?? null;
        if (cover !== null && (typeof cover !== "string" || !cover.startsWith("/api/covers/"))) {
            throw new Error("category cover: not a cover address");
        }
        return {
            name: c.name,
            videos: count(c.videos, "category videos"),
            color: c.color,
            image: c.image,
            cover,
        };
    });
}
export async function fetchVideos(options, signal) {
    const params = new URLSearchParams();
    if (options.category)
        params.set("category", options.category);
    if (options.uploader)
        params.set("uploader", String(options.uploader));
    if (options.shared)
        params.set("shared", "1");
    if (options.q)
        params.set("q", options.q);
    if (options.seed) {
        params.set("order", "random");
        params.set("seed", String(options.seed));
    }
    if (options.limit !== undefined)
        params.set("limit", String(options.limit));
    if (options.offset)
        params.set("offset", String(options.offset));
    const query = params.toString();
    return parseVideoList(await request(`/api/videos${query ? `?${query}` : ""}`, { signal }));
}
export async function fetchVideo(id, signal) {
    return parseVideo(await request(`/api/videos/${id}`, { signal }));
}
export async function fetchCategories(signal) {
    return parseCategories(await request("/api/categories", { signal }));
}
// streamURL is the address of the video file, for the player: the copy
// made for every device when there is one, the file itself if original.
export function streamURL(id, original = false) {
    return `/api/videos/${id}/stream${original ? "?original=1" : ""}`;
}
// playsFileItself reports whether this browser can play the file of a
// video as it is: then it gets the file at its full quality, not the copy
// made for every device. canPlayType answers "probably" only when it
// knows the box and every format inside.
export function playsFileItself(video, canPlayType) {
    return video.fileType !== "" && canPlayType(video.fileType) === "probably";
}
export function parseSubtitles(data) {
    if (!Array.isArray(data)) {
        throw new Error("subtitles: not a list");
    }
    return data.map((item) => {
        const s = record(item, "subtitle");
        if (typeof s.key !== "string" || s.key === "")
            throw new Error("subtitle key: empty");
        if (typeof s.lang !== "string")
            throw new Error("subtitle lang: not text");
        if (typeof s.label !== "string" || s.label === "")
            throw new Error("subtitle label: empty");
        if (typeof s.src !== "string" || !s.src.startsWith("/api/videos/")) {
            throw new Error("subtitle src: not a subtitle address");
        }
        return { key: s.key, lang: s.lang, label: s.label, src: s.src };
    });
}
export async function fetchSubtitles(id, signal) {
    return parseSubtitles(await request(`/api/videos/${id}/subtitles`, { signal }));
}
const copyStates = ["ready", "waiting", "working", "failed", "none"];
export function parseCopyProgress(data) {
    const d = (data ?? {});
    const state = copyStates.find((s) => s === d.state);
    if (!state)
        throw new Error("copy state: not a known state");
    const percent = d.percent ?? null;
    if (percent !== null &&
        (typeof percent !== "number" || !Number.isInteger(percent) || percent < 0 || percent > 100)) {
        throw new Error("copy percent: not a percentage");
    }
    return { state, percent };
}
// prepareVideo tells the server this browser cannot play a video: its copy
// for every device goes before every other job. It answers where the copy
// is, and asking again only answers that.
export async function prepareVideo(id) {
    return parseCopyProgress(await request(`/api/videos/${id}/prepare`, { method: "POST" }));
}
