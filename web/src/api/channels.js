// Channels: the page of each person, with the playlists they chose to
// show to everyone.
import { request } from "./client";
import { parseSharePeople } from "./people";
import { parsePlaylist } from "./playlists";
export function parseChannel(data) {
    if (typeof data !== "object" || data === null)
        throw new Error("channel: not an object");
    const d = data;
    if (typeof d.id !== "number" || !Number.isInteger(d.id) || d.id <= 0) {
        throw new Error("channel id: not an id");
    }
    if (typeof d.name !== "string" || d.name === "")
        throw new Error("channel name: not a name");
    const since = typeof d.since === "string" ? new Date(d.since) : new Date(Number.NaN);
    if (Number.isNaN(since.getTime()))
        throw new Error("channel since: not a date");
    if (typeof d.avatar !== "number" || !Number.isInteger(d.avatar) || d.avatar < 0) {
        throw new Error("channel avatar: not a version");
    }
    if (!Array.isArray(d.playlists))
        throw new Error("channel playlists: not a list");
    return {
        id: d.id,
        name: d.name,
        avatar: d.avatar,
        since,
        playlists: d.playlists.map(parsePlaylist),
    };
}
export async function fetchChannel(id, signal) {
    return parseChannel(await request(`/api/channels/${id}`, { signal }));
}
// searchPeople returns, by name, the people whose name contains every
// word searched: at most a few, so the search page stays about videos.
export async function searchPeople(q, signal) {
    const data = await request(`/api/channels?${new URLSearchParams({ q })}`, { signal });
    if (typeof data !== "object" || data === null)
        throw new Error("people found: not an object");
    return parseSharePeople(data.people, "people found");
}
