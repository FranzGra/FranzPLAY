// The Home's layout: which rows each person closed, and how they like the
// cards. It is kept by the server, so it follows the person on every device.
import { request } from "./client";
export const homeRows = ["continue", "saved", "liked", "recommended", "latest"];
export const homeSections = ["one", "two", "scroll"];
export const defaultHomeLook = { columns: 0, size: 3, sections: "one" };
export function parseHomeLayout(data) {
    if (typeof data !== "object" || data === null)
        throw new Error("home layout: not an object");
    const { closed, look } = data;
    if (!Array.isArray(closed))
        throw new Error("home layout closed: not a list");
    return {
        closed: closed.map((row) => {
            if (!homeRows.includes(row))
                throw new Error(`home layout: unknown row ${String(row)}`);
            return row;
        }),
        look: parseHomeLook(look),
    };
}
function parseHomeLook(data) {
    if (typeof data !== "object" || data === null)
        throw new Error("home look: not an object");
    const { columns, size, sections } = data;
    if (typeof columns !== "number" || !(columns === 0 || (columns >= 2 && columns <= 6))) {
        throw new Error(`home look columns: ${String(columns)}`);
    }
    if (typeof size !== "number" || size < 1 || size > 5) {
        throw new Error(`home look size: ${String(size)}`);
    }
    if (!homeSections.includes(sections)) {
        throw new Error(`home look sections: ${String(sections)}`);
    }
    return { columns, size, sections: sections };
}
export async function fetchHomeLayout(signal) {
    return parseHomeLayout(await request("/api/home", { signal }));
}
// setRowOpen opens or closes a row, and returns the layout as it is now.
export async function setRowOpen(row, open) {
    return parseHomeLayout(await request(`/api/home/rows/${row}`, { method: "PUT", body: { open } }));
}
// setHomeLook keeps how the person likes the cards.
export async function setHomeLook(look) {
    return parseHomeLayout(await request("/api/home/look", { method: "PUT", body: look }));
}
