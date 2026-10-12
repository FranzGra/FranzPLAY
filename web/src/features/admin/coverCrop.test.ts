import { clampOffset, cropRect, scale, windowOf } from "./coverCrop";

const window = windowOf(320); // 320 × 180

describe("cover crop", () => {
  it("covers the window at zoom 1", () => {
    // A tall picture fills the width; a wide one fills the height.
    expect(scale({ width: 640, height: 960 }, window, 1)).toBe(0.5);
    expect(scale({ width: 3600, height: 900 }, window, 1)).toBe(0.2);
  });

  it("never leaves an empty corner", () => {
    const tall = { width: 640, height: 960 }; // shown 320 × 480
    expect(clampOffset(tall, window, 1, { x: 50, y: 500 })).toEqual({ x: 0, y: 150 });
    expect(clampOffset(tall, window, 1, { x: 0, y: -500 })).toEqual({ x: 0, y: -150 });
  });

  it("cuts the middle by default, and what the window shows when moved", () => {
    const tall = { width: 640, height: 960 };
    expect(cropRect(tall, window, 1, { x: 0, y: 0 })).toEqual({
      x: 0,
      y: 300,
      width: 640,
      height: 360,
    });
    // Moved down by 100 window pixels: the cut goes up by 200 picture pixels.
    expect(cropRect(tall, window, 1, { x: 0, y: 100 })).toEqual({
      x: 0,
      y: 100,
      width: 640,
      height: 360,
    });
    // At zoom 2 the window shows half as much, around the center.
    expect(cropRect(tall, window, 2, { x: 0, y: 0 })).toEqual({
      x: 160,
      y: 390,
      width: 320,
      height: 180,
    });
  });

  it("keeps the shape of a cover", () => {
    const r = cropRect({ width: 1234, height: 777 }, window, 1.7, { x: 13, y: -9 });
    expect(r.width / r.height).toBeCloseTo(16 / 9);
  });
});
