// The math of cropping a profile photo: pure functions, no page, no canvas.
//
// The photo is shown in a square window `view` pixels wide. At zoom 1 it
// just covers the window (its short side fits exactly); zoom makes it
// bigger. offset is how far the photo's center is moved from the window's
// center, in window pixels.

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };

export const minZoom = 1;
export const maxZoom = 4;

// The side of the photo that is saved, in pixels: enough for a sharp
// avatar on any screen, small enough to send quickly.
export const outputSide = 512;

// scale is how many window pixels one photo pixel takes.
export function scale(image: Size, view: number, zoom: number): number {
  return (view / Math.min(image.width, image.height)) * zoom;
}

// clampOffset keeps the photo covering the whole window: no empty corner.
export function clampOffset(image: Size, view: number, zoom: number, offset: Point): Point {
  const s = scale(image, view, zoom);
  const maxX = (image.width * s - view) / 2;
  const maxY = (image.height * s - view) / 2;
  return { x: within(offset.x, maxX), y: within(offset.y, maxY) };
}

// within keeps value between -limit and limit; no room means 0.
function within(value: number, limit: number): number {
  return limit <= 0 ? 0 : Math.min(limit, Math.max(-limit, value));
}

// cropRect is the square of the photo, in photo pixels, that the window
// shows: the part that becomes the profile photo.
export function cropRect(
  image: Size,
  view: number,
  zoom: number,
  offset: Point,
): { x: number; y: number; side: number } {
  const s = scale(image, view, zoom);
  const o = clampOffset(image, view, zoom, offset);
  const side = view / s;
  return {
    x: image.width / 2 - o.x / s - side / 2,
    y: image.height / 2 - o.y / s - side / 2,
    side,
  };
}
