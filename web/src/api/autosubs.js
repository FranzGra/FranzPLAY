// Automatic subtitles: whisper writes them from the sound of a video, a
// translator turns them into other languages. Only the administrator asks.
import { request } from "./client";
function strings(value, what) {
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
        throw new Error(`${what}: not a list of text`);
    }
    return value;
}
export function parseSetup(data) {
    const d = (data ?? {});
    if (typeof d.whisper !== "boolean" || typeof d.translator !== "boolean") {
        throw new Error("subtitles setup: bad whisper or translator");
    }
    if (typeof d.translatorError !== "string" || typeof d.modelsFolder !== "string") {
        throw new Error("subtitles setup: bad text");
    }
    return {
        whisper: d.whisper,
        models: strings(d.models, "models"),
        translator: d.translator,
        translatorError: d.translatorError,
        translatorLanguages: strings(d.translatorLanguages, "translatorLanguages"),
        languages: strings(d.languages, "languages"),
        modelsFolder: d.modelsFolder,
        downloadable: parseDownloadable(d.downloadable),
        download: d.download === null ? null : parseDownload(d.download),
    };
}
function parseDownloadable(data) {
    if (!Array.isArray(data))
        throw new Error("downloadable: not a list");
    return data.map((m) => {
        const d = (m ?? {});
        if (typeof d.name !== "string" || typeof d.about !== "string" || typeof d.size !== "number") {
            throw new Error("downloadable: bad model");
        }
        return { name: d.name, size: d.size, about: d.about };
    });
}
function parseDownload(data) {
    const d = (data ?? {});
    if (typeof d.name !== "string" || typeof d.error !== "string" || typeof d.ended !== "boolean") {
        throw new Error("download: bad text");
    }
    if (typeof d.done !== "number" || typeof d.total !== "number")
        throw new Error("download: bad size");
    return { name: d.name, done: d.done, total: d.total, error: d.error, ended: d.ended };
}
// downloadModel has FranzPLAY download a whisper model by itself.
export async function downloadModel(name) {
    await request(`/api/admin/subtitles/models/${encodeURIComponent(name)}`, { method: "POST" });
}
const sources = ["file", "inside", "auto"];
const stages = ["", "audio", "transcribe", "translate"];
const states = ["", "pending", "running", "done", "failed"];
function parseSubtitle(data) {
    const d = (data ?? {});
    if (typeof d.lang !== "string" || typeof d.from !== "string")
        throw new Error("subtitle: bad text");
    if (!sources.includes(d.source))
        throw new Error("subtitle: bad source");
    return { lang: d.lang, source: d.source, from: d.from };
}
function parseRequest(data) {
    const d = (data ?? {});
    if (typeof d.spoken !== "string" || typeof d.model !== "string" || typeof d.error !== "string") {
        throw new Error("subtitle request: bad text");
    }
    if (!stages.includes(d.stage))
        throw new Error("subtitle request: bad stage");
    if (!states.includes(d.state))
        throw new Error("subtitle request: bad state");
    const at = typeof d.at === "string" ? new Date(d.at) : new Date(Number.NaN);
    if (Number.isNaN(at.getTime()))
        throw new Error("subtitle request: bad date");
    return {
        spoken: d.spoken,
        model: d.model,
        translate: strings(d.translate, "translate"),
        stage: d.stage,
        state: d.state,
        error: d.error,
        at,
    };
}
export function parseSubtitledVideo(data) {
    const d = (data ?? {});
    if (typeof d.id !== "number" || !Number.isInteger(d.id) || d.id <= 0) {
        throw new Error("subtitled video: bad id");
    }
    if (typeof d.title !== "string")
        throw new Error("subtitled video: bad title");
    if (d.cover !== null && typeof d.cover !== "string")
        throw new Error("subtitled video: bad cover");
    if (!Array.isArray(d.subtitles))
        throw new Error("subtitled video: no subtitles list");
    return {
        id: d.id,
        title: d.title,
        cover: d.cover,
        subtitles: d.subtitles.map(parseSubtitle),
        request: d.request === null ? null : parseRequest(d.request),
    };
}
export async function fetchSubtitlesSetup(signal) {
    return parseSetup(await request("/api/admin/subtitles/setup", { signal }));
}
export async function fetchSubtitledVideos(options, signal) {
    const params = new URLSearchParams({ limit: String(options.limit) });
    if (options.q)
        params.set("q", options.q);
    if (options.have)
        params.set("have", options.have);
    if (options.lang)
        params.set("lang", options.lang);
    const data = await request(`/api/admin/subtitles?${params}`, { signal });
    const d = (data ?? {});
    if (!Array.isArray(d.videos))
        throw new Error("subtitled videos: not a list");
    if (typeof d.total !== "number" || !Number.isInteger(d.total) || d.total < 0) {
        throw new Error("subtitled videos: bad total");
    }
    return { videos: d.videos.map(parseSubtitledVideo), total: d.total };
}
// askSubtitles asks whisper for the subtitles of a video, and their
// translations. It replaces what was asked before.
export async function askSubtitles(id, ask) {
    await request(`/api/admin/subtitles/${id}`, { method: "PUT", body: ask });
}
// takeBackSubtitles forgets what was asked for a video.
export async function takeBackSubtitles(id) {
    await request(`/api/admin/subtitles/${id}/request`, { method: "DELETE" });
}
// deleteMadeSubtitles deletes subtitles whisper made, in one language.
export async function deleteMadeSubtitles(id, lang) {
    await request(`/api/admin/subtitles/${id}/made/${encodeURIComponent(lang)}`, {
        method: "DELETE",
    });
}
// languageNames are the languages FranzPLAY names, in Italian.
const languageNames = {
    it: "Italiano",
    en: "Inglese",
    es: "Spagnolo",
    fr: "Francese",
    de: "Tedesco",
    pt: "Portoghese",
};
// languageName names a language for people: "Italiano", or the code.
export function languageName(code) {
    return languageNames[code] ?? (code ? code.toUpperCase() : "Lingua non detta");
}
