// The name and color of the whole site, chosen by the administrator.
import { request } from "./client";
// The limits the server checks, so mistakes show at once and in Italian.
export const maxNamePart = 16;
// defaultLook is how a new FranzPLAY looks, and what is shown until the
// server answers.
export const defaultLook = { nameFirst: "Franz", nameSecond: "PLAY", color: "#2997ff" };
// siteName is the name in one piece, for the browser tab.
export function siteName(look) {
    return look.nameFirst + look.nameSecond;
}
// lookProblem explains what is wrong with a look, or returns "".
export function lookProblem(look) {
    const first = [...look.nameFirst.trim()].length;
    const second = [...look.nameSecond.trim()].length;
    if (first === 0)
        return "Scrivi almeno la prima parte del nome.";
    if (first > maxNamePart || second > maxNamePart) {
        return `Ogni parte del nome può avere al massimo ${maxNamePart} caratteri.`;
    }
    if (!/^#[0-9a-f]{6}$/i.test(look.color))
        return "Scegli un colore.";
    return "";
}
// parseLook checks the look sent by the server, once, at the edge.
export function parseLook(data) {
    if (typeof data !== "object" || data === null) {
        throw new Error("site: response is not an object");
    }
    const { nameFirst, nameSecond, color } = data;
    if (typeof nameFirst !== "string" || nameFirst === "") {
        throw new Error("site: bad nameFirst");
    }
    if (typeof nameSecond !== "string") {
        throw new Error("site: bad nameSecond");
    }
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/.test(color)) {
        throw new Error("site: bad color");
    }
    return { nameFirst, nameSecond, color };
}
export async function fetchLook(signal) {
    return parseLook(await request("/api/site", { signal }));
}
// saveLook changes name and color for everybody: administrators only.
export async function saveLook(look) {
    return parseLook(await request("/api/site", { method: "PUT", body: look }));
}
