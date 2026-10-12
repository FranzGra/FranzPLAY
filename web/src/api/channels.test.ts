import { parseChannel } from "./channels";

const channel = (over: Record<string, unknown> = {}) => ({
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
