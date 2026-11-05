// The name and color of the whole site, and the shape of the category
// covers, chosen by the administrator.

import { request } from "./client";

// CategoryShape is the shape of the covers of every category.
export type CategoryShape = "portrait" | "square" | "landscape";

export const categoryShapes: { id: CategoryShape; label: string; ratio: string }[] = [
  { id: "portrait", label: "Verticale", ratio: "2:3" },
  { id: "square", label: "Quadrata", ratio: "1:1" },
  { id: "landscape", label: "Orizzontale", ratio: "16:9" },
];

export type Look = {
  nameFirst: string; // the logo's first part, in the normal text color
  nameSecond: string; // the second part, in the site's color; may be ""
  color: string; // "#rrggbb"
  categoryShape: CategoryShape;
};

// The limits the server checks, so mistakes show at once and in Italian.
export const maxNamePart = 16;

// defaultLook is how a new FranzPLAY looks, and what is shown until the
// server answers.
export const defaultLook: Look = {
  nameFirst: "Franz",
  nameSecond: "PLAY",
  color: "#2997ff",
  categoryShape: "landscape",
};

// siteName is the name in one piece, for the browser tab.
export function siteName(look: Look): string {
  return look.nameFirst + look.nameSecond;
}

// lookProblem explains what is wrong with a look, or returns "".
export function lookProblem(look: Look): string {
  const first = [...look.nameFirst.trim()].length;
  const second = [...look.nameSecond.trim()].length;
  if (first === 0) return "Scrivi almeno la prima parte del nome.";
  if (first > maxNamePart || second > maxNamePart) {
    return `Ogni parte del nome può avere al massimo ${maxNamePart} caratteri.`;
  }
  if (!/^#[0-9a-f]{6}$/i.test(look.color)) return "Scegli un colore.";
  return "";
}

function isShape(value: unknown): value is CategoryShape {
  return categoryShapes.some((s) => s.id === value);
}

// parseLook checks the look sent by the server, once, at the edge.
export function parseLook(data: unknown): Look {
  if (typeof data !== "object" || data === null) {
    throw new Error("site: response is not an object");
  }
  const { nameFirst, nameSecond, color, categoryShape } = data as Record<string, unknown>;
  if (typeof nameFirst !== "string" || nameFirst === "") {
    throw new Error("site: bad nameFirst");
  }
  if (typeof nameSecond !== "string") {
    throw new Error("site: bad nameSecond");
  }
  if (typeof color !== "string" || !/^#[0-9a-f]{6}$/.test(color)) {
    throw new Error("site: bad color");
  }
  // An older server sends no shape: the covers keep the first one.
  return {
    nameFirst,
    nameSecond,
    color,
    categoryShape: isShape(categoryShape) ? categoryShape : defaultLook.categoryShape,
  };
}

export async function fetchLook(signal?: AbortSignal): Promise<Look> {
  return parseLook(await request("/api/site", { signal }));
}

// saveLook changes name, color and covers for everybody: administrators only.
export async function saveLook(look: Look): Promise<Look> {
  return parseLook(await request("/api/site", { method: "PUT", body: look }));
}
