import { tileColor } from "./color";
describe("tileColor", () => {
    it("uses the administrator's color", () => {
        expect(tileColor({ name: "Scuola", color: "#e11d48" })).toBe("#e11d48");
    });
    it("gives each name always the same color from the palette", () => {
        const first = tileColor({ name: "Vacanze", color: "" });
        expect(first).toMatch(/^#[0-9a-f]{6}$/);
        expect(tileColor({ name: "Vacanze", color: "" })).toBe(first);
    });
});
