// Playlists: the lists of videos each person makes, and their
// "Guarda più tardi" list.

import { request } from "./client";
import { parseSharePeople, type SharePerson } from "./people";
import { parseVideo, type Video } from "./videos";

export type Playlist = {
  id: number;
  // later is "Guarda più tardi": everyone has one, it has no name of its
  // own and cannot be renamed or deleted.
  kind: "playlist" | "later";
  name: string;
  owner: { id: number; name: string };
  // public says the list shows on its owner's channel, for everyone.
  public: boolean;
  // sharedWith are the people a list not on the channel is shared with;
  // only its owner learns them, the others get [].
  sharedWith: SharePerson[];
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
  const o = (d.owner ?? {}) as Record<string, unknown>;
  if (
    typeof o.id !== "number" ||
    !Number.isInteger(o.id) ||
    o.id <= 0 ||
    typeof o.name !== "string"
  ) {
    throw new Error("playlist owner: not a person");
  }
  if (typeof d.public !== "boolean") throw new Error("playlist public: not true or false");
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
    owner: { id: o.id, name: o.name },
    public: d.public,
    sharedWith:
      d.sharedWith === undefined ? [] : parseSharePeople(d.sharedWith, "playlist sharedWith"),
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

// changes tells the parts of the page that show my lists, like the side
// menu, that one was created, renamed or deleted.
const changes = new EventTarget();

// onPlaylistsChanged calls listener after each change to my lists, and
// returns the function that stops it.
export function onPlaylistsChanged(listener: () => void): () => void {
  changes.addEventListener("change", listener);
  return () => changes.removeEventListener("change", listener);
}

function changed() {
  changes.dispatchEvent(new Event("change"));
}

export async function createPlaylist(name: string): Promise<Playlist> {
  const created = parsePlaylist(
    await request("/api/playlists", { method: "POST", body: { name } }),
  );
  changed();
  return created;
}

export async function renamePlaylist(id: number, name: string): Promise<void> {
  await request(`/api/playlists/${id}`, { method: "PUT", body: { name } });
  changed();
}

// fetchSharedPlaylists returns the lists others shared with me, the most
// recently changed first.
export async function fetchSharedPlaylists(signal?: AbortSignal): Promise<Playlist[]> {
  return parsePlaylists(await request("/api/playlists/shared", { signal }));
}

// sharePlaylist changes who sees one of my lists: on my channel for
// everybody (public), or only me and the people in sharedWith, by id.
export async function sharePlaylist(
  id: number,
  who: { public: boolean; sharedWith: number[] },
): Promise<void> {
  const body = who.public ? { public: true } : { public: false, sharedWith: who.sharedWith };
  await request(`/api/playlists/${id}`, { method: "PUT", body });
}

export async function deletePlaylist(id: number): Promise<void> {
  await request(`/api/playlists/${id}`, { method: "DELETE" });
  changed();
}

// putInPlaylist adds a video to a list (in true) or takes it out.
export async function putInPlaylist(id: number, video: number, inList: boolean): Promise<void> {
  await request(`/api/playlists/${id}/videos/${video}`, { method: inList ? "PUT" : "DELETE" });
}
