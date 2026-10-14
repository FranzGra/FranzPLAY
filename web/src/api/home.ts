// The Home's layout: which rows each person closed, and how they like the
// cards. It is kept by the server, so it follows the person on every device.

import { request } from "./client";

export const homeRows = ["continue", "saved", "liked", "recommended", "latest"] as const;
export type HomeRow = (typeof homeRows)[number];

export const homeSections = ["one", "two", "scroll"] as const;
// HomeSections is how much of each section shows: one or two lines of
// cards, or every card in a line that scrolls sideways.
export type HomeSections = (typeof homeSections)[number];

// HomeLook is how the cards look on a computer or tablet. columns is how
// many in a line (2-6), or 0 to let size (1 small - 5 big) decide.
export type HomeLook = { columns: number; size: number; sections: HomeSections };

export const defaultHomeLook: HomeLook = { columns: 0, size: 3, sections: "one" };

export type HomeLayout = { closed: HomeRow[]; look: HomeLook };

export function parseHomeLayout(data: unknown): HomeLayout {
  if (typeof data !== "object" || data === null) throw new Error("home layout: not an object");
  const { closed, look } = data as Record<string, unknown>;
  if (!Array.isArray(closed)) throw new Error("home layout closed: not a list");
  return {
    closed: closed.map((row) => {
      if (!homeRows.includes(row)) throw new Error(`home layout: unknown row ${String(row)}`);
      return row as HomeRow;
    }),
    look: parseHomeLook(look),
  };
}

function parseHomeLook(data: unknown): HomeLook {
  if (typeof data !== "object" || data === null) throw new Error("home look: not an object");
  const { columns, size, sections } = data as Record<string, unknown>;
  if (typeof columns !== "number" || !(columns === 0 || (columns >= 2 && columns <= 6))) {
    throw new Error(`home look columns: ${String(columns)}`);
  }
  if (typeof size !== "number" || size < 1 || size > 5) {
    throw new Error(`home look size: ${String(size)}`);
  }
  if (!homeSections.includes(sections as HomeSections)) {
    throw new Error(`home look sections: ${String(sections)}`);
  }
  return { columns, size, sections: sections as HomeSections };
}

export async function fetchHomeLayout(signal?: AbortSignal): Promise<HomeLayout> {
  return parseHomeLayout(await request("/api/home", { signal }));
}

// setRowOpen opens or closes a row, and returns the layout as it is now.
export async function setRowOpen(row: HomeRow, open: boolean): Promise<HomeLayout> {
  return parseHomeLayout(await request(`/api/home/rows/${row}`, { method: "PUT", body: { open } }));
}

// setHomeLook keeps how the person likes the cards.
export async function setHomeLook(look: HomeLook): Promise<HomeLayout> {
  return parseHomeLayout(await request("/api/home/look", { method: "PUT", body: look }));
}
