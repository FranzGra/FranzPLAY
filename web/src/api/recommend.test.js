import { videoJSON } from "../test/fixtures";
import { parseSuggestions, reasonText } from "./recommend";
import { parseVideo } from "./videos";
describe("parseSuggestions", () => {
    it("accepts the suggested videos with their reason", () => {
        const [first] = parseSuggestions([{ video: videoJSON(), reason: "sameCategory" }]);
        expect(first?.video.title).toBe("Mare 2024");
        expect(first?.reason).toBe("sameCategory");
    });
    it.each([
        ["not a list", {}],
        ["not an object", [5]],
        ["unknown reason", [{ video: videoJSON(), reason: "magic" }]],
        ["no reason", [{ video: videoJSON() }]],
        ["bad video", [{ video: { id: 0 }, reason: "newest" }]],
    ])("refuses %s", (_, data) => {
        expect(() => parseSuggestions(data)).toThrow();
    });
});
describe("reasonText", () => {
    const video = parseVideo(videoJSON());
    it.each([
        ["watchedTogether", "Visto da chi ha visto questo"],
        ["sameCategory", "Anche questo in Vacanze"],
        ["similarTitle", "Titolo simile"],
        ["yourCategory", "Perché guardi Vacanze"],
        ["popular", "Guardato anche da altri"],
        ["newest", ""],
    ])("says %s in words", (reason, text) => {
        expect(reasonText({ video, reason })).toBe(text);
    });
});
