// The video folders, as the administrator checks them.

import { request } from "./client";

export type LibraryFolder = {
  path: string;
  videos: number;
  missing: number;
  problem: string; // "" when the folder was read completely
  looksUnplugged: boolean; // empty but had videos: is the disk connected?
};

export type ScanCounts = {
  unchanged: number;
  added: number;
  moved: number;
  updated: number;
  restored: number;
  missing: number;
  duplicates: number;
  forgotten: number;
  problems: number;
};

export type LastScan = ScanCounts & { at: Date; seconds: number; error: string };

export type LibraryOverview = {
  scanning: boolean;
  interval: number; // seconds between two automatic checks
  lastScan: LastScan | null;
  folders: LibraryFolder[];
  minDuration: number; // seconds; a shorter video of the folders is left out, 0 = none
  tooShort: number; // videos left out because they are shorter
};

const countNames = [
  "unchanged",
  "added",
  "moved",
  "updated",
  "restored",
  "missing",
  "duplicates",
  "forgotten",
  "problems",
] as const;

function count(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new Error(`library ${what}: not a count`);
  }
  return v;
}

function parseFolder(data: unknown): LibraryFolder {
  if (typeof data !== "object" || data === null) throw new Error("library folder: not an object");
  const d = data as Record<string, unknown>;
  if (typeof d.path !== "string" || d.path === "") throw new Error("library folder: bad path");
  if (typeof d.problem !== "string") throw new Error("library folder: bad problem");
  if (typeof d.looksUnplugged !== "boolean") throw new Error("library folder: bad looksUnplugged");
  return {
    path: d.path,
    videos: count(d.videos, "videos"),
    missing: count(d.missing, "missing"),
    problem: d.problem,
    looksUnplugged: d.looksUnplugged,
  };
}

function parseLastScan(data: unknown): LastScan {
  if (typeof data !== "object" || data === null) throw new Error("last scan: not an object");
  const d = data as Record<string, unknown>;
  const at = typeof d.at === "string" ? new Date(d.at) : new Date(Number.NaN);
  if (Number.isNaN(at.getTime())) throw new Error("last scan: bad at");
  if (typeof d.seconds !== "number" || d.seconds < 0) throw new Error("last scan: bad seconds");
  if (typeof d.error !== "string") throw new Error("last scan: bad error");
  const counts = Object.fromEntries(countNames.map((n) => [n, count(d[n], n)])) as ScanCounts;
  return { ...counts, at, seconds: d.seconds, error: d.error };
}

export function parseLibraryOverview(data: unknown): LibraryOverview {
  if (typeof data !== "object" || data === null) throw new Error("library: not an object");
  const d = data as Record<string, unknown>;
  if (typeof d.scanning !== "boolean") throw new Error("library: bad scanning");
  if (!Array.isArray(d.folders)) throw new Error("library: folders not a list");
  return {
    scanning: d.scanning,
    interval: count(d.interval, "interval"),
    lastScan: d.lastScan === null ? null : parseLastScan(d.lastScan),
    folders: d.folders.map(parseFolder),
    minDuration: count(d.minDuration, "minDuration"),
    tooShort: count(d.tooShort, "tooShort"),
  };
}

export async function fetchLibrary(signal?: AbortSignal): Promise<LibraryOverview> {
  return parseLibraryOverview(await request("/api/library", { signal }));
}

// scanLibrary asks FranzPLAY to check the folders now.
export async function scanLibrary(): Promise<void> {
  await request("/api/library/scan", { method: "POST" });
}

// The longest minimum the server accepts, in seconds.
export const maxMinDuration = 600;

// saveMinDuration leaves out the videos of the folders shorter than
// seconds; 0 shows them all again.
export async function saveMinDuration(seconds: number): Promise<void> {
  await request("/api/library/min-duration", { method: "PUT", body: { seconds } });
}
