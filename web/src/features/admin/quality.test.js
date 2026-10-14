import { compatibility, qualityLabel } from "./quality";
describe("qualityLabel", () => {
    it.each([
        [2160, "4K"],
        [4320, "4K"],
        [1440, "2K"],
        [1080, "1080p"],
        [1079, "720p"],
        [720, "720p"],
        [576, "480p"],
        [480, "480p"],
        [360, "SD"],
        [null, ""],
        [0, ""],
    ])("%s pixels high is %j", (height, want) => {
        expect(qualityLabel(height)).toBe(want);
    });
});
describe("compatibility", () => {
    const video = (v) => ({ duration: 60, playable: true, hasCopy: false, ...v });
    it("tells whether every browser plays the video", () => {
        expect(compatibility(video({}))).toEqual({ label: "Va su tutti i browser", ok: true });
        expect(compatibility(video({ playable: true, hasCopy: true }))?.label).toBe("Copia per tutti i browser");
        expect(compatibility(video({ playable: false }))).toEqual({
            label: "Non va su tutti i browser",
            ok: false,
        });
        expect(compatibility(video({ duration: null }))).toBeNull();
    });
});
