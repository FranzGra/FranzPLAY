import {
  bufferedEnd,
  clampTime,
  clampVolume,
  keyAction,
  previewFrame,
  speedLabel,
  tapZone,
  timeAt,
} from "./controls";

describe("clampTime", () => {
  it.each([
    [-5, 100, 0],
    [50, 100, 50],
    [150, 100, 100],
    [30, Number.NaN, 30], // duration not known yet
    [-3, Number.NaN, 0],
  ])("%d in %d is %d", (time, duration, want) => {
    expect(clampTime(time, duration)).toBe(want);
  });
});

describe("timeAt", () => {
  it.each([
    [100, 100, 400, 200, 0],
    [300, 100, 400, 200, 100],
    [500, 100, 400, 200, 200],
    [50, 100, 400, 200, 0], // left of the timeline
    [900, 100, 400, 200, 200], // right of the timeline
    [300, 100, 0, 200, 0], // no width
    [300, 100, 400, Number.NaN, 0], // duration unknown
  ])("x=%d", (x, left, width, duration, want) => {
    expect(timeAt(x, left, width, duration)).toBe(want);
  });
});

describe("bufferedEnd", () => {
  const ranges = [
    { start: 0, end: 30 },
    { start: 60, end: 90 },
  ];
  it.each([
    [10, 30],
    [70, 90],
    [45, 45], // not downloaded around here
  ])("at %d is %d", (time, want) => {
    expect(bufferedEnd(ranges, time)).toBe(want);
  });
});

describe("keyAction", () => {
  it.each([
    [" ", { kind: "toggle-play" }],
    ["k", { kind: "toggle-play" }],
    ["ArrowLeft", { kind: "seek-by", seconds: -10 }],
    ["j", { kind: "seek-by", seconds: -10 }],
    ["ArrowRight", { kind: "seek-by", seconds: 10 }],
    ["L", { kind: "seek-by", seconds: 10 }],
    ["ArrowUp", { kind: "volume-by", amount: 0.1 }],
    ["m", { kind: "toggle-mute" }],
    ["f", { kind: "toggle-fullscreen" }],
    ["c", { kind: "toggle-subtitles" }],
    ["0", { kind: "seek-to-fraction", fraction: 0 }],
    ["5", { kind: "seek-to-fraction", fraction: 0.5 }],
    ["End", { kind: "seek-to-fraction", fraction: 1 }],
    ["Tab", null],
    ["a", null],
    ["Enter", null],
  ])("%j", (key, want) => {
    expect(keyAction(key)).toEqual(want);
  });
});

describe("tapZone", () => {
  it.each([
    [10, "back"],
    [150, "middle"],
    [290, "forward"],
  ] as const)("x=%d is %s", (x, want) => {
    expect(tapZone(x, 0, 300)).toBe(want);
  });
});

describe("clampVolume", () => {
  it.each([
    [0.2 + 0.1, 0.3],
    [1.05, 1],
    [-0.1, 0],
  ])("%d", (volume, want) => {
    expect(clampVolume(volume)).toBe(want);
  });
});

describe("speedLabel", () => {
  it.each([
    [1, "Normale"],
    [1.5, "1,5×"],
    [0.25, "0,25×"],
    [2, "2×"],
  ])("%d", (speed, want) => {
    expect(speedLabel(speed)).toBe(want);
  });
});

describe("previewFrame", () => {
  const preview = { gap: 2, count: 45, columns: 10, width: 160, height: 90 };
  it.each([
    [0, 0, 0],
    [1.9, 0, 0],
    [2, 160, 0],
    [19.5, 1440, 0], // frame 9, end of the first row
    [20, 0, 90], // frame 10, second row
    [88, 640, 360], // frame 44, the last
    [500, 640, 360], // past the end: still the last
    [-3, 0, 0],
  ])("at %s seconds the frame is at %i,%i", (time, x, y) => {
    expect(previewFrame(preview, time)).toEqual({ x, y });
  });
});
