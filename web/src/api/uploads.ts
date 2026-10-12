// Uploading my videos: how much space I have, the uploads not finished
// yet, and the pieces of a file on its way.

import { request } from "./client";

export type Space = {
  quota: number; // bytes the administrator gave me
  used: number; // bytes of my uploaded videos
  reserved: number; // bytes of my unfinished uploads
};

export type Upload = {
  id: number;
  name: string; // the file name on my computer
  title: string;
  size: number; // bytes
  received: number; // bytes that arrived
  video?: number; // the new video, once the last piece arrived
};

export type MyUploads = {
  space: Space;
  uploads: Upload[];
};

const isBytes = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

export function parseUpload(data: unknown): Upload {
  if (typeof data !== "object" || data === null) throw new Error("upload: not an object");
  const d = data as Record<string, unknown>;
  if (typeof d.id !== "number" || !Number.isInteger(d.id) || d.id <= 0)
    throw new Error("upload id");
  if (typeof d.name !== "string" || d.name === "") throw new Error("upload name");
  if (typeof d.title !== "string" || d.title === "") throw new Error("upload title");
  if (!isBytes(d.size) || d.size === 0) throw new Error("upload size");
  if (!isBytes(d.received) || d.received > d.size) throw new Error("upload received");
  const upload: Upload = {
    id: d.id,
    name: d.name,
    title: d.title,
    size: d.size,
    received: d.received,
  };
  if (d.video !== undefined) {
    if (typeof d.video !== "number" || !Number.isInteger(d.video) || d.video <= 0) {
      throw new Error("upload video");
    }
    upload.video = d.video;
  }
  return upload;
}

export function parseMyUploads(data: unknown): MyUploads {
  if (typeof data !== "object" || data === null) throw new Error("uploads: not an object");
  const { space, uploads } = data as Record<string, unknown>;
  if (typeof space !== "object" || space === null) throw new Error("uploads space");
  const s = space as Record<string, unknown>;
  if (!isBytes(s.quota) || !isBytes(s.used) || !isBytes(s.reserved)) {
    throw new Error("uploads space: not bytes");
  }
  if (!Array.isArray(uploads)) throw new Error("uploads: not a list");
  return {
    space: { quota: s.quota, used: s.used, reserved: s.reserved },
    uploads: uploads.map(parseUpload),
  };
}

export async function fetchMyUploads(signal?: AbortSignal): Promise<MyUploads> {
  return parseMyUploads(await request("/api/uploads", { signal }));
}

// startUpload tells the server a file is coming. Without a title, the
// server takes the file name.
export async function startUpload(file: { name: string; size: number }, title: string) {
  return parseUpload(
    await request("/api/uploads", {
      method: "POST",
      body: { name: file.name, title, size: file.size },
    }),
  );
}

// sendPiece sends the bytes of piece, which start at byte offset of the
// file. A piece cut with file.slice() has no type: it goes as plain bytes.
export async function sendPiece(
  id: number,
  offset: number,
  piece: Blob,
  signal?: AbortSignal,
): Promise<Upload> {
  return parseUpload(
    await request(`/api/uploads/${id}?offset=${offset}`, { method: "PUT", body: piece, signal }),
  );
}

export async function cancelUpload(id: number): Promise<void> {
  await request(`/api/uploads/${id}`, { method: "DELETE" });
}
