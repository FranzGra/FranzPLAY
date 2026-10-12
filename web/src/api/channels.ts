// Channels: the page of each person, with the playlists they chose to
// show to everyone.

import { request } from "./client";
import { type Playlist, parsePlaylist } from "./playlists";

export type Channel = {
  id: number;
  name: string;
  since: Date; // when they joined FranzPLAY
  playlists: Playlist[]; // public ones only
};

export function parseChannel(data: unknown): Channel {
  if (typeof data !== "object" || data === null) throw new Error("channel: not an object");
  const d = data as Record<string, unknown>;
  if (typeof d.id !== "number" || !Number.isInteger(d.id) || d.id <= 0) {
    throw new Error("channel id: not an id");
  }
  if (typeof d.name !== "string" || d.name === "") throw new Error("channel name: not a name");
  const since = typeof d.since === "string" ? new Date(d.since) : new Date(Number.NaN);
  if (Number.isNaN(since.getTime())) throw new Error("channel since: not a date");
  if (!Array.isArray(d.playlists)) throw new Error("channel playlists: not a list");
  return { id: d.id, name: d.name, since, playlists: d.playlists.map(parsePlaylist) };
}

export async function fetchChannel(id: number, signal?: AbortSignal): Promise<Channel> {
  return parseChannel(await request(`/api/channels/${id}`, { signal }));
}
