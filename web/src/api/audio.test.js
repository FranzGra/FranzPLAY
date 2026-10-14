import { parseAudioStart, parseAudioTracks } from "./audio";
describe("parseAudioTracks", () => {
    it("accepts a list of tracks", () => {
        const tracks = [
            { stream: 1, lang: "it", label: "Italiano", default: true },
            { stream: 2, lang: "", label: "Audio 2", default: false },
        ];
        expect(parseAudioTracks(tracks)).toEqual(tracks);
    });
    it.each([
        ["not a list", {}],
        ["negative stream", [{ stream: -1, lang: "", label: "Audio 1", default: false }]],
        ["empty label", [{ stream: 1, lang: "", label: "", default: false }]],
        ["no default", [{ stream: 1, lang: "", label: "Audio 1" }]],
    ])("refuses %s", (_, data) => {
        expect(() => parseAudioTracks(data)).toThrow();
    });
});
describe("parseAudioStart", () => {
    it("accepts a start", () => {
        const start = { start: 5, src: "/api/videos/3/audio/2/stream?at=5" };
        expect(parseAudioStart(start)).toEqual(start);
    });
    it.each([
        ["negative start", { start: -1, src: "/api/videos/3/audio/2/stream" }],
        ["address elsewhere", { start: 0, src: "https://example.com/video" }],
    ])("refuses %s", (_, data) => {
        expect(() => parseAudioStart(data)).toThrow();
    });
});
