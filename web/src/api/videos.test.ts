import { videoJSON } from "../test/fixtures";
import { fakeServer } from "../test/render";
import {
  fetchVideos,
  parseCategories,
  parseCopyProgress,
  parseVideo,
  playsFileItself,
  streamURL,
} from "./videos";

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

  it("accepts the people a private video is shared with", () => {
    expect(parseVideo(sampleVideo).sharedWith).toEqual([]);
    const anna = { id: 3, name: "Anna", avatar: 0 };
    expect(parseVideo({ ...sampleVideo, private: true, sharedWith: [anna] }).sharedWith).toEqual([
      anna,
    ]);
  });

  it("reads whose the video is, with their photo", () => {
    const owner = { id: 1, name: "Anna", avatar: 77 };
    expect(parseVideo({ ...sampleVideo, owner }).owner).toEqual(owner);
    expect(parseVideo(sampleVideo).owner).toBeNull();
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
    ["private not true or false", { ...sampleVideo, private: 1 }],
    ["uploader without a name", { ...sampleVideo, uploader: { id: 3, name: "" } }],
    ["uploader without an id", { ...sampleVideo, uploader: { id: 0, name: "Giulia" } }],
    ["owner without a name", { ...sampleVideo, owner: { id: 1, name: "", avatar: 0 } }],
    ["owner without a photo version", { ...sampleVideo, owner: { id: 1, name: "Anna" } }],
    ["bad person shared with", { ...sampleVideo, sharedWith: [{ id: 3, name: "" }] }],
    ["numeric description", { ...sampleVideo, description: 5 }],
    ["zero id", { ...sampleVideo, id: 0 }],
    ["numeric title", { ...sampleVideo, title: 3 }],
    ["negative duration", { ...sampleVideo, duration: -1 }],
    ["cover elsewhere", { ...sampleVideo, cover: "https://evil.example/x.jpg" }],
    ["bad date", { ...sampleVideo, addedAt: "yesterday" }],
    ["missing playable", { ...sampleVideo, playable: undefined }],
    ["missing preview", { ...sampleVideo, preview: undefined }],
    ["missing clip", { ...sampleVideo, clip: undefined }],
    ["clip elsewhere", { ...sampleVideo, clip: "https://evil.example/x.mp4" }],
    ["sharp clip elsewhere", { ...sampleVideo, clipHD: "https://evil.example/x.mp4" }],
    ["sharp clip in the light folder", { ...sampleVideo, clipHD: "/api/clips/1-a.mp4" }],
    ["missing format", { ...sampleVideo, format: undefined }],
    ["format not a kind of file", { ...sampleVideo, format: "<b>MP4</b>" }],
    ["missing likes", { ...sampleVideo, likes: undefined }],
    ["negative likes", { ...sampleVideo, likes: -2 }],
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
    const vacanze = {
      name: "Vacanze",
      videos: 3,
      color: "#e11d48",
      image: "/api/category-images/1-0123456789abcdef.jpg",
    };
    expect(
      parseCategories([vacanze, { name: "Corsi", videos: 1, color: "", image: null }]),
    ).toEqual([vacanze, { name: "Corsi", videos: 1, color: "", image: null }]);
  });

  it.each([
    ["an object", { name: "Vacanze" }],
    ["an empty name", [{ name: "", videos: 1 }]],
    ["a bad count", [{ name: "Vacanze", videos: "3", color: "", image: null }]],
    ["a bad color", [{ name: "Vacanze", videos: 3, color: "red", image: null }]],
    ["a foreign image", [{ name: "Vacanze", videos: 3, color: "", image: "https://x/y.jpg" }]],
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

describe("playsFileItself", () => {
  const webm = parseVideo(
    videoJSON({ fileType: 'video/webm; codecs="vp09.00.40.08, opus"', playable: true, copy: true }),
  );

  it("plays the file itself only when the browser is sure", () => {
    expect(playsFileItself(webm, () => "probably")).toBe(true);
    expect(playsFileItself(webm, () => "maybe")).toBe(false);
    expect(playsFileItself(webm, () => "")).toBe(false);
  });

  it("never asks about a file no browser is worth asking about", () => {
    const mkv = parseVideo(videoJSON({ fileType: "" }));
    expect(playsFileItself(mkv, () => "probably")).toBe(false);
  });

  it("asks for the file itself by address", () => {
    expect(streamURL(7)).toBe("/api/videos/7/stream");
    expect(streamURL(7, true)).toBe("/api/videos/7/stream?original=1");
  });
});

describe("parseCopyProgress", () => {
  it("reads where the copy is and how far", () => {
    expect(parseCopyProgress({ state: "working", percent: 40 })).toEqual({
      state: "working",
      percent: 40,
    });
    expect(parseCopyProgress({ state: "waiting" })).toEqual({ state: "waiting", percent: null });
  });

  it("refuses what is not a copy state", () => {
    expect(() => parseCopyProgress({ state: "done" })).toThrow();
    expect(() => parseCopyProgress({ state: "working", percent: 140 })).toThrow();
    expect(() => parseCopyProgress(null)).toThrow();
  });
});
