import { parseMyVideo } from "./myVideos";

const video = {
  id: 12,
  title: "Al mare",
  size: 3,
  addedAt: "2026-10-12T20:00:00Z",
  cover: null,
  hidden: false,
  private: false,
  sharedWith: [{ id: 3, name: "Anna", avatar: 0 }],
  link: null,
};

describe("parseMyVideo", () => {
  it("accepts one of my videos", () => {
    expect(parseMyVideo(video)).toEqual({ ...video, addedAt: new Date("2026-10-12T20:00:00Z") });
    const link = "/video/12?k=abcdefghijklmnopqrstuv";
    expect(parseMyVideo({ ...video, private: true, sharedWith: [], link }).link).toBe(link);
  });

  it.each([
    ["null", null],
    ["zero id", { ...video, id: 0 }],
    ["no title", { ...video, title: "" }],
    ["negative size", { ...video, size: -1 }],
    ["bad date", { ...video, addedAt: "ieri" }],
    ["bad cover", { ...video, cover: 3 }],
    ["no hidden", { ...video, hidden: undefined }],
    ["no private", { ...video, private: "no" }],
    ["no sharedWith", { ...video, sharedWith: undefined }],
    ["bad person", { ...video, sharedWith: [{ id: 3 }] }],
    ["no link", { ...video, link: undefined }],
    ["link elsewhere", { ...video, link: "https://example.com/video/12?k=abcdefghijklmnopqrstuv" }],
    ["link without key", { ...video, link: "/video/12?k=abc" }],
  ])("rejects %s", (_label, data) => {
    expect(() => parseMyVideo(data)).toThrow();
  });
});
