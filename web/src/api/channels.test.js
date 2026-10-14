import { fakeServer } from "../test/render";
import { parseChannel, searchPeople } from "./channels";
const channel = (over = {}) => ({
    id: 5,
    name: "Giulia",
    avatar: 0,
    since: "2026-03-10T09:00:00Z",
    playlists: [],
    ...over,
});
describe("parseChannel", () => {
    it("accepts a channel", () => {
        expect(parseChannel(channel())).toEqual({
            id: 5,
            name: "Giulia",
            avatar: 0,
            since: new Date("2026-03-10T09:00:00Z"),
            playlists: [],
        });
    });
    it.each([
        ["not an object", null],
        ["no id", channel({ id: 0 })],
        ["no name", channel({ name: "" })],
        ["bad date", channel({ since: "ieri" })],
        ["no avatar", channel({ avatar: undefined })],
        ["no playlists", channel({ playlists: undefined })],
        ["bad playlist", channel({ playlists: [{ id: 1 }] })],
    ])("refuses %s", (_, data) => {
        expect(() => parseChannel(data)).toThrow();
    });
});
describe("searchPeople", () => {
    it("asks for the words and checks the people found", async () => {
        const { requests } = fakeServer({
            "GET /api/channels": { body: { people: [{ id: 3, name: "Anna", avatar: 0 }] } },
        });
        expect(await searchPeople("anna rossi")).toEqual([{ id: 3, name: "Anna", avatar: 0 }]);
        expect(new URL(requests[0]?.url ?? "").searchParams.get("q")).toBe("anna rossi");
    });
    it("refuses an answer without people", async () => {
        fakeServer({ "GET /api/channels": { body: { people: [{ id: 0 }] } } });
        await expect(searchPeople("anna")).rejects.toThrow();
    });
});
