import { fakeServer } from "../test/render";
import {
  createPlaylist,
  deletePlaylist,
  onPlaylistsChanged,
  parsePlaylistPage,
  parsePlaylists,
  playlistName,
  putInPlaylist,
  renamePlaylist,
} from "./playlists";

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
      sharedWith: [],
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
    ["bad person shared with", [playlist({ sharedWith: [{ id: 3 }] })]],
  ])("refuses %s", (_, data) => {
    expect(() => parsePlaylists(data)).toThrow();
  });
});

describe("parsePlaylistPage", () => {
  it("refuses a page without videos", () => {
    expect(() => parsePlaylistPage({ playlist: playlist() })).toThrow();
  });
});

describe("onPlaylistsChanged", () => {
  it("tells when one of my lists is created, renamed or deleted", async () => {
    fakeServer({
      "POST /api/playlists": { status: 201, body: playlist() },
      "PUT /api/playlists/2": { status: 204 },
      "DELETE /api/playlists/2": { status: 204 },
      "PUT /api/playlists/2/videos/7": { status: 204 },
    });
    const listener = vi.fn();
    const stop = onPlaylistsChanged(listener);
    await createPlaylist("Gite");
    await renamePlaylist(2, "Gite al mare");
    await deletePlaylist(2);
    expect(listener).toHaveBeenCalledTimes(3);

    // Adding a video does not change the names in the menu.
    await putInPlaylist(2, 7, true);
    expect(listener).toHaveBeenCalledTimes(3);

    stop();
    await createPlaylist("Feste");
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
