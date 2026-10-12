import { parsePlaylistPage, parsePlaylists, playlistName } from "./playlists";

const playlist = (over: Record<string, unknown> = {}) => ({
  id: 3,
  kind: "playlist",
  name: "Vacanze",
  owner: { id: 1, name: "Francesco" },
  public: false,
  videos: 2,
  cover: "/api/covers/a.jpg",
  updatedAt: "2026-10-12T09:00:00Z",
  ...over,
});

describe("parsePlaylists", () => {
  it("accepts lists and watch later", () => {
    const [later, mine] = parsePlaylists([
      playlist({ id: 1, kind: "later", name: "", cover: null, contains: true }),
      playlist(),
    ]);
    expect(later).toEqual({
      id: 1,
      kind: "later",
      name: "",
      owner: { id: 1, name: "Francesco" },
      public: false,
      videos: 2,
      cover: null,
      updatedAt: new Date("2026-10-12T09:00:00Z"),
      contains: true,
    });
    expect(mine).not.toHaveProperty("contains");
    expect(later && playlistName(later)).toBe("Guarda più tardi");
    expect(mine && playlistName(mine)).toBe("Vacanze");
  });

  it.each([
    ["not a list", {}],
    ["no id", [playlist({ id: 0 })]],
    ["unknown kind", [playlist({ kind: "public" })]],
    ["no name", [playlist({ name: "" })]],
    ["no owner", [playlist({ owner: undefined })]],
    ["bad owner", [playlist({ owner: { id: 0, name: "x" } })]],
    ["bad public", [playlist({ public: "sì" })]],
    ["bad count", [playlist({ videos: -1 })]],
    ["foreign cover", [playlist({ cover: "https://example.com/x.jpg" })]],
    ["bad date", [playlist({ updatedAt: "ieri" })]],
    ["bad contains", [playlist({ contains: "sì" })]],
  ])("refuses %s", (_, data) => {
    expect(() => parsePlaylists(data)).toThrow();
  });
});

describe("parsePlaylistPage", () => {
  it("refuses a page without videos", () => {
    expect(() => parsePlaylistPage({ playlist: playlist() })).toThrow();
  });
});
