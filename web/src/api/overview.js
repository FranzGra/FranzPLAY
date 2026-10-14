// The administrator's summary: numbers, disks and what needs attention.
import { request } from "./client";
const problemKinds = [
    "disk_full",
    "disk_low",
    "disk_unread",
    "failed_jobs",
    "missing_videos",
    "no_covers",
    "no_ffmpeg",
];
function object(data, what) {
    if (typeof data !== "object" || data === null)
        throw new Error(`overview: ${what} is not an object`);
    return data;
}
function count(o, key) {
    const n = o[key];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0)
        throw new Error(`overview: bad ${key}`);
    return n;
}
function parseProblem(data) {
    const o = object(data, "problem");
    const { kind, severity, folder = "", count: n = 0 } = o;
    if (typeof kind !== "string" || !problemKinds.includes(kind)) {
        throw new Error(`overview: unknown problem ${JSON.stringify(kind)}`);
    }
    if (severity !== "warning" && severity !== "critical")
        throw new Error("overview: bad severity");
    if (typeof folder !== "string")
        throw new Error("overview: bad folder");
    if (typeof n !== "number")
        throw new Error("overview: bad count");
    return { kind: kind, severity, count: n, folder };
}
function parseDisk(data) {
    const o = object(data, "disk");
    if (typeof o.folder !== "string")
        throw new Error("overview: bad disk folder");
    if (typeof o.data !== "boolean" || typeof o.error !== "boolean") {
        throw new Error("overview: bad disk");
    }
    return {
        folder: o.folder,
        data: o.data,
        total: count(o, "total"),
        free: count(o, "free"),
        error: o.error,
    };
}
// parseOverview checks the summary sent by the server, once, at the edge.
export function parseOverview(data) {
    const o = object(data, "answer");
    const v = object(o.videos, "videos");
    const j = object(o.jobs, "jobs");
    if (typeof o.version !== "string")
        throw new Error("overview: bad version");
    if (!Array.isArray(o.disks) || !Array.isArray(o.problems))
        throw new Error("overview: bad lists");
    return {
        version: o.version,
        videos: {
            present: count(v, "present"),
            hidden: count(v, "hidden"),
            missing: count(v, "missing"),
            analysed: count(v, "analysed"),
            playable: count(v, "playable"),
            noCover: count(v, "noCover"),
        },
        categories: count(o, "categories"),
        people: count(o, "people"),
        admins: count(o, "admins"),
        comments: count(o, "comments"),
        jobs: { waiting: count(j, "waiting"), failed: count(j, "failed") },
        disks: o.disks.map(parseDisk),
        problems: o.problems.map(parseProblem),
    };
}
export async function fetchOverview(signal) {
    return parseOverview(await request("/api/overview", { signal }));
}
