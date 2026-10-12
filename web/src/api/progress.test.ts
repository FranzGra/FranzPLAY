import { videoJSON } from "../test/fixtures";
import { fakeServer } from "../test/render";
import { parseContinue, parseProgress, saveProgress } from "./progress";

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
    const [first] = parseContinue([{ video: videoJSON(), position: 60 }]);
    expect(first?.video.title).toBe("Mare 2024");
    expect(first?.position).toBe(60);
  });

  it.each([
    ["not a list", {}],
    ["bad video", [{ video: { id: 0 }, position: 1 }]],
    ["bad position", [{ video: videoJSON(), position: null }]],
  ])("refuses %s", (_, data) => {
    expect(() => parseContinue(data)).toThrow();
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
