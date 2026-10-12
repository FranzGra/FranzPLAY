import { parseMyVideo } from "./myVideos";

const video = {
  id: 12,
  title: "Al mare",
  size: 3,
  addedAt: "2026-10-12T20:00:00Z",
  cover: null,
  hidden: false,
  private: false,
};

describe("parseMyVideo", () => {
  it("accepts one of my videos", () => {
    expect(parseMyVideo(video)).toEqual({ ...video, addedAt: new Date("2026-10-12T20:00:00Z") });
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
  ])("rejects %s", (_label, data) => {
    expect(() => parseMyVideo(data)).toThrow();
  });
});
