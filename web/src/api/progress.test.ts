import { watchedJSON } from "../test/fixtures";
import { fakeServer } from "../test/render";
import { parseContinue, parseHistory, parseProgress, saveProgress } from "./progress";

describe("parseProgress", () => {
  it("accepts a valid mark", () => {
    expect(parseProgress({ position: 125, finished: false })).toEqual({
      position: 125,
      finished: false,
    });
  });

  it.each([
    ["not an object", 5],
    ["negative", { position: -1, finished: false }],
    ["fraction", { position: 1.5, finished: false }],
    ["text", { position: "5", finished: false }],
    ["no finished", { position: 5 }],
  ])("refuses %s", (_, data) => {
    expect(() => parseProgress(data)).toThrow();
  });
});

describe("parseContinue", () => {
  it("accepts the videos in progress", () => {
    const [first] = parseContinue([watchedJSON()]);
    expect(first?.video.title).toBe("Mare 2024");
    expect(first?.position).toBe(60);
    expect(first?.watchedAt).toEqual(new Date("2026-10-11T20:30:00Z"));
  });

  it.each([
    ["not a list", {}],
    ["bad video", [watchedJSON({ video: { id: 0 } })]],
    ["bad position", [watchedJSON({ position: null })]],
    ["no finished", [watchedJSON({ finished: undefined })]],
    ["bad date", [watchedJSON({ watchedAt: "ieri" })]],
  ])("refuses %s", (_, data) => {
    expect(() => parseContinue(data)).toThrow();
  });
});

describe("parseHistory", () => {
  it("accepts a page of the history", () => {
    const h = parseHistory({ items: [watchedJSON({ finished: true })], total: 5 });
    expect(h.total).toBe(5);
    expect(h.items[0]?.finished).toBe(true);
  });

  it.each([
    ["no items", { total: 0 }],
    ["bad total", { items: [], total: -1 }],
    ["bad item", { items: [{}], total: 1 }],
  ])("refuses %s", (_, data) => {
    expect(() => parseHistory(data)).toThrow();
  });
});

describe("saveProgress", () => {
  it("sends the position so that it arrives even while the page closes", async () => {
    const { requests } = fakeServer({
      "POST /api/videos/7/progress": { body: { position: 42, finished: false } },
    });
    await saveProgress(7, 42.5);
    const sent = requests[0];
    expect(sent?.keepalive).toBe(true);
    expect(await sent?.json()).toEqual({ position: 42.5 });
  });
});
