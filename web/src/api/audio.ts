// Sound tracks: a video can have more than one language. The browser plays
// only the first; for the others the server makes a copy of the video
// with that sound while it plays.

import { request } from "./client";

export type AudioTrack = {
  stream: number; // the track's number inside the file
  lang: string; // "it", "en"; "" = unknown
  label: string; // "Italiano"
  default: boolean; // the one the file plays first
};

// AudioStart says where to play a sound track from: the server's copy
// begins at start seconds (a little before the time asked for), at src.
export type AudioStart = {
  start: number;
  src: string;
};

function object(data: unknown, what: string): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`${what}: not an object`);
  }
  return data as Record<string, unknown>;
}

export function parseAudioTracks(data: unknown): AudioTrack[] {
  if (!Array.isArray(data)) throw new Error("audio: not a list");
  return data.map((item) => {
    const a = object(item, "audio track");
    if (typeof a.stream !== "number" || !Number.isInteger(a.stream) || a.stream < 0) {
      throw new Error("audio stream: not a track number");
    }
    if (typeof a.lang !== "string") throw new Error("audio lang: not text");
    if (typeof a.label !== "string" || a.label === "") throw new Error("audio label: empty");
    if (typeof a.default !== "boolean") throw new Error("audio default: not true or false");
    return { stream: a.stream, lang: a.lang, label: a.label, default: a.default };
  });
}

export function parseAudioStart(data: unknown): AudioStart {
  const a = object(data, "audio start");
  if (typeof a.start !== "number" || !Number.isFinite(a.start) || a.start < 0) {
    throw new Error("audio start: not a time");
  }
  if (typeof a.src !== "string" || !a.src.startsWith("/api/videos/")) {
    throw new Error("audio src: not a video address");
  }
  return { start: a.start, src: a.src };
}

// fetchAudioTracks returns the sound tracks of a video; empty when there
// is nothing to choose.
export async function fetchAudioTracks(id: number, signal?: AbortSignal): Promise<AudioTrack[]> {
  return parseAudioTracks(await request(`/api/videos/${id}/audio`, { signal }));
}

// fetchAudioStart asks where to play a sound track from to reach at seconds.
export async function fetchAudioStart(id: number, stream: number, at: number): Promise<AudioStart> {
  const seconds = Math.max(0, Math.round(at * 1000) / 1000);
  return parseAudioStart(await request(`/api/videos/${id}/audio/${stream}?at=${seconds}`));
}
