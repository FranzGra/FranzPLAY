import { clampOffset, cropRect, scale } from "./crop";
const wide = { width: 1600, height: 1000 };
describe("crop", () => {
    it("covers the window at zoom 1 with the short side", () => {
        expect(scale(wide, 250, 1)).toBe(0.25);
        expect(scale(wide, 250, 2)).toBe(0.5);
    });
    it("takes the middle square when nothing is moved", () => {
        expect(cropRect(wide, 250, 1, { x: 0, y: 0 })).toEqual({ x: 300, y: 0, side: 1000 });
    });
    it("takes a smaller square when zoomed in", () => {
        expect(cropRect(wide, 250, 2, { x: 0, y: 0 })).toEqual({ x: 550, y: 250, side: 500 });
    });
    it("follows the photo when it is dragged", () => {
        // Dragging the photo right shows more of its left side.
        expect(cropRect(wide, 250, 1, { x: 50, y: 0 })).toEqual({ x: 100, y: 0, side: 1000 });
    });
    it("never leaves an empty corner", () => {
        expect(clampOffset(wide, 250, 1, { x: 999, y: 999 })).toEqual({ x: 75, y: 0 });
        expect(clampOffset(wide, 250, 1, { x: -999, y: -5 })).toEqual({ x: -75, y: 0 });
        const r = cropRect(wide, 250, 1, { x: 999, y: 0 });
        expect(r.x).toBe(0);
        const far = cropRect(wide, 250, 3, { x: -9999, y: -9999 });
        expect(far.x + far.side).toBeCloseTo(1600);
        expect(far.y + far.side).toBeCloseTo(1000);
    });
});
