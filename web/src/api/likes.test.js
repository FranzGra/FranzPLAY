import { parseLike } from "./likes";
describe("parseLike", () => {
    it("accepts a valid like", () => {
        expect(parseLike({ liked: true, count: 4 })).toEqual({ liked: true, count: 4 });
    });
    it.each([
        ["not an object", null],
        ["no liked", { count: 1 }],
        ["negative count", { liked: false, count: -1 }],
        ["fraction", { liked: false, count: 1.5 }],
    ])("refuses %s", (_, data) => {
        expect(() => parseLike(data)).toThrow();
    });
});
