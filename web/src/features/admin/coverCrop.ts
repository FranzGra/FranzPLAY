// The math of cutting a picture to a 16:9 cover: pure functions, no page,
// no canvas. Like the profile photo's (features/profile/crop.ts), but the
// window is a rectangle the shape of the covers in the grid.
//
// The picture is shown in a window `view` wide and 9/16 of it tall. At
// zoom 1 it just covers the window; zoom makes it bigger. offset is how far
// the picture's center is moved from the window's center, in window pixels.

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

export const minZoom = 1;
export const maxZoom = 4;

// The size of the image sent to the server: twice the covers' width, so
// it stays sharp, and quick to send.
export const output: Size = { width: 1280, height: 720 };

// windowOf is the window `view` pixels wide, in the shape of a cover.
export function windowOf(view: number): Size {
  return { width: view, height: (view * 9) / 16 };
}

// scale is how many window pixels one picture pixel takes.
export function scale(image: Size, window: Size, zoom: number): number {
  return Math.max(window.width / image.width, window.height / image.height) * zoom;
}

// clampOffset keeps the picture covering the whole window: no empty corner.
export function clampOffset(image: Size, window: Size, zoom: number, offset: Point): Point {
  const s = scale(image, window, zoom);
  const maxX = (image.width * s - window.width) / 2;
  const maxY = (image.height * s - window.height) / 2;
  return { x: within(offset.x, maxX), y: within(offset.y, maxY) };
}

// within keeps value between -limit and limit; no room means 0.
function within(value: number, limit: number): number {
  return limit <= 0 ? 0 : Math.min(limit, Math.max(-limit, value));
}

// cropRect is the part of the picture, in picture pixels, that the window
// shows: the part that becomes the cover.
export function cropRect(image: Size, window: Size, zoom: number, offset: Point): Rect {
  const s = scale(image, window, zoom);
  const o = clampOffset(image, window, zoom, offset);
  const width = window.width / s;
  const height = window.height / s;
  return {
    x: image.width / 2 - o.x / s - width / 2,
    y: image.height / 2 - o.y / s - height / 2,
    width,
    height,
  };
}
