import { videoJSON } from "../test/fixtures";
import { fakeServer } from "../test/render";
import { fetchVideos, parseCategories, parseVideo } from "./videos";

const sampleVideo = videoJSON();

describe("parseVideo", () => {
  it("accepts a valid video", () => {
    const v = parseVideo(sampleVideo);
    expect(v.addedAt).toEqual(new Date("2026-10-10T08:00:00Z"));
    expect(v.duration).toBe(245);
  });

  it("accepts a video not read yet", () => {
    const v = parseVideo({
      ...sampleVideo,
      duration: null,
      width: null,
      height: null,
      cover: null,
    });
    expect(v.duration).toBeNull();
    expect(v.cover).toBeNull();
  });

  it.each([
    ["no id", { ...sampleVideo, id: undefined }],
    ["zero id", { ...sampleVideo, id: 0 }],
    ["numeric title", { ...sampleVideo, title: 3 }],
    ["negative duration", { ...sampleVideo, duration: -1 }],
    ["cover elsewhere", { ...sampleVideo, cover: "https://evil.example/x.jpg" }],
    ["bad date", { ...sampleVideo, addedAt: "yesterday" }],
    ["missing playable", { ...sampleVideo, playable: undefined }],
  ])("rejects %s", (_label, data) => {
    expect(() => parseVideo(data)).toThrow();
  });
});

describe("parseCategories", () => {
  it("accepts a list", () => {
    expect(parseCategories([{ name: "Vacanze", videos: 3 }])).toEqual([
      { name: "Vacanze", videos: 3 },
    ]);
  });

  it.each([
    ["an object", { name: "Vacanze" }],
    ["an empty name", [{ name: "", videos: 1 }]],
    ["a bad count", [{ name: "Vacanze", videos: "3" }]],
  ])("rejects %s", (_label, data) => {
    expect(() => parseCategories(data)).toThrow();
  });
});

describe("fetchVideos", () => {
  it("asks for a category and a page", async () => {
    const { requests } = fakeServer({
      "GET /api/videos": { body: { videos: [sampleVideo], total: 1 } },
    });
    const list = await fetchVideos({ category: "Gite & mare", limit: 24, offset: 48 });
    expect(list.total).toBe(1);
    const url = new URL(requests[0]?.url ?? "");
    expect(url.searchParams.get("category")).toBe("Gite & mare");
    expect(url.searchParams.get("limit")).toBe("24");
    expect(url.searchParams.get("offset")).toBe("48");
  });
});
