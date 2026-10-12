// Playlists: the lists of videos each person makes, and their
// "Guarda più tardi" list.

import { request } from "./client";
import { parseVideo, type Video } from "./videos";

export type Playlist = {
  id: number;
  // later is "Guarda più tardi": everyone has one, it has no name of its
  // own and cannot be renamed or deleted.
  kind: "playlist" | "later";
  name: string;
  videos: number;
  cover: string | null; // the first video's cover
  updatedAt: Date;
  // contains says whether the list has the video asked about, when one was.
  contains?: boolean;
};

export type PlaylistPage = {
  playlist: Playlist;
  videos: Video[];
};

// maxNameLength is the longest name the server accepts.
export const maxNameLength = 100;

// playlistName is the name to show for a list.
export function playlistName(p: Playlist): string {
  return p.kind === "later" ? "Guarda più tardi" : p.name;
}

export function parsePlaylist(data: unknown): Playlist {
  if (typeof data !== "object" || data === null) throw new Error("playlist: not an object");
  const d = data as Record<string, unknown>;
  if (typeof d.id !== "number" || !Number.isInteger(d.id) || d.id <= 0) {
    throw new Error("playlist id: not an id");
  }
  if (d.kind !== "playlist" && d.kind !== "later") throw new Error("playlist kind: unknown");
  if (typeof d.name !== "string" || (d.kind === "playlist" && d.name === "")) {
    throw new Error("playlist name: not a name");
  }
  if (typeof d.videos !== "number" || !Number.isInteger(d.videos) || d.videos < 0) {
    throw new Error("playlist videos: not a count");
  }
  if (d.cover !== null && (typeof d.cover !== "string" || !d.cover.startsWith("/api/covers/"))) {
    throw new Error("playlist cover: not a cover address");
  }
  const updatedAt = typeof d.updatedAt === "string" ? new Date(d.updatedAt) : new Date(Number.NaN);
  if (Number.isNaN(updatedAt.getTime())) throw new Error("playlist updatedAt: not a date");
  if (d.contains !== undefined && typeof d.contains !== "boolean") {
    throw new Error("playlist contains: not true or false");
  }
  return {
    id: d.id,
    kind: d.kind,
    name: d.name,
    videos: d.videos,
    cover: d.cover,
    updatedAt,
    ...(d.contains === undefined ? {} : { contains: d.contains }),
  };
}

export function parsePlaylists(data: unknown): Playlist[] {
  if (!Array.isArray(data)) throw new Error("playlists: not a list");
  return data.map(parsePlaylist);
}

export function parsePlaylistPage(data: unknown): PlaylistPage {
  if (typeof data !== "object" || data === null) throw new Error("playlist page: not an object");
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.videos)) throw new Error("playlist page videos: not a list");
  return { playlist: parsePlaylist(d.playlist), videos: d.videos.map(parseVideo) };
}

// fetchPlaylists returns my lists, "Guarda più tardi" first. With a
// video, each list also says whether it has it.
export async function fetchPlaylists(video?: number, signal?: AbortSignal): Promise<Playlist[]> {
  const query = video === undefined ? "" : `?video=${video}`;
  return parsePlaylists(await request(`/api/playlists${query}`, { signal }));
}

export async function fetchPlaylist(id: number, signal?: AbortSignal): Promise<PlaylistPage> {
  return parsePlaylistPage(await request(`/api/playlists/${id}`, { signal }));
}

export async function createPlaylist(name: string): Promise<Playlist> {
  return parsePlaylist(await request("/api/playlists", { method: "POST", body: { name } }));
}

export async function renamePlaylist(id: number, name: string): Promise<void> {
  await request(`/api/playlists/${id}`, { method: "PUT", body: { name } });
}

export async function deletePlaylist(id: number): Promise<void> {
  await request(`/api/playlists/${id}`, { method: "DELETE" });
}

// putInPlaylist adds a video to a list (in true) or takes it out.
export async function putInPlaylist(id: number, video: number, inList: boolean): Promise<void> {
  await request(`/api/playlists/${id}/videos/${video}`, { method: inList ? "PUT" : "DELETE" });
}
