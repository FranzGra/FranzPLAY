// The Home's layout: which rows each person closed. It is kept by the
// server, so it follows the person on every device.

import { request } from "./client";

export const homeRows = ["continue", "saved", "liked", "recommended", "latest"] as const;
export type HomeRow = (typeof homeRows)[number];

export type HomeLayout = { closed: HomeRow[] };

export function parseHomeLayout(data: unknown): HomeLayout {
  if (typeof data !== "object" || data === null) throw new Error("home layout: not an object");
  const closed = (data as Record<string, unknown>).closed;
  if (!Array.isArray(closed)) throw new Error("home layout closed: not a list");
  return {
    closed: closed.map((row) => {
      if (!homeRows.includes(row)) throw new Error(`home layout: unknown row ${String(row)}`);
      return row as HomeRow;
    }),
  };
}

export async function fetchHomeLayout(signal?: AbortSignal): Promise<HomeLayout> {
  return parseHomeLayout(await request("/api/home", { signal }));
}

// setRowOpen opens or closes a row, and returns the layout as it is now.
export async function setRowOpen(row: HomeRow, open: boolean): Promise<HomeLayout> {
  return parseHomeLayout(await request(`/api/home/rows/${row}`, { method: "PUT", body: { open } }));
}
