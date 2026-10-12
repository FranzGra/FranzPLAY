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

  it("accepts the previews of the timeline", () => {
    const preview = {
      src: "/api/previews/7-0a.jpg",
      gap: 2,
      count: 45,
      columns: 10,
      width: 160,
      height: 90,
    };
    expect(parseVideo({ ...sampleVideo, preview }).preview).toEqual(preview);
  });

  it("accepts what a file next to the video says", () => {
    const v = parseVideo({
      ...sampleVideo,
      author: "Famiglia Rossi",
      publishedOn: "2019-03-15",
      description: "Che giornata!",
    });
    expect(v.author).toBe("Famiglia Rossi");
    expect(v.publishedOn).toEqual(new Date(2019, 2, 15));
    expect(v.description).toBe("Che giornata!");
    expect(parseVideo(sampleVideo).description).toBe("");
  });

  it.each([
    ["no id", { ...sampleVideo, id: undefined }],
    ["no author", { ...sampleVideo, author: undefined }],
    ["published on a time", { ...sampleVideo, publishedOn: "2019-03-15T10:00:00Z" }],
    ["published on no real day", { ...sampleVideo, publishedOn: "2019-02-30" }],
    ["numeric description", { ...sampleVideo, description: 5 }],
    ["zero id", { ...sampleVideo, id: 0 }],
    ["numeric title", { ...sampleVideo, title: 3 }],
    ["negative duration", { ...sampleVideo, duration: -1 }],
    ["cover elsewhere", { ...sampleVideo, cover: "https://evil.example/x.jpg" }],
    ["bad date", { ...sampleVideo, addedAt: "yesterday" }],
    ["missing playable", { ...sampleVideo, playable: undefined }],
    ["missing preview", { ...sampleVideo, preview: undefined }],
    [
      "preview elsewhere",
      {
        ...sampleVideo,
        preview: {
          src: "https://evil.example/x.jpg",
          gap: 2,
          count: 1,
          columns: 1,
          width: 160,
          height: 90,
        },
      },
    ],
    [
      "preview with no frames",
      {
        ...sampleVideo,
        preview: {
          src: "/api/previews/7-0a.jpg",
          gap: 2,
          count: 0,
          columns: 1,
          width: 160,
          height: 90,
        },
      },
    ],
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
