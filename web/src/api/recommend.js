// Suggested videos: the ones to watch after a video, and the ones the
// person may like. Each comes with why it is suggested.
import { request } from "./client";
import { parseVideo } from "./videos";
const reasons = [
    "watchedTogether",
    "sameCategory",
    "similarTitle",
    "yourCategory",
    "popular",
    "newest",
];
function isReason(value) {
    return typeof value === "string" && reasons.includes(value);
}
export function parseSuggestions(data) {
    if (!Array.isArray(data))
        throw new Error("suggestions: not a list");
    return data.map((item) => {
        if (typeof item !== "object" || item === null)
            throw new Error("suggestion: not an object");
        const d = item;
        if (!isReason(d.reason))
            throw new Error("suggestion reason: not a known reason");
        return { video: parseVideo(d.video), reason: d.reason };
    });
}
// reasonText is the reason in words, under the video's title; "" when
// there is nothing to say beyond what the card already shows.
export function reasonText({ video, reason }) {
    switch (reason) {
        case "watchedTogether":
            return "Visto da chi ha visto questo";
        case "sameCategory":
            return video.category ? `Anche questo in ${video.category}` : "Della stessa categoria";
        case "similarTitle":
            return "Titolo simile";
        case "yourCategory":
            return video.category ? `Perché guardi ${video.category}` : "Per i tuoi gusti";
        case "popular":
            return "Guardato anche da altri";
        case "newest":
            return "";
    }
}
export async function fetchSimilar(id, signal) {
    return parseSuggestions(await request(`/api/videos/${id}/similar`, { signal }));
}
export async function fetchRecommended(signal) {
    return parseSuggestions(await request("/api/recommended", { signal }));
}
