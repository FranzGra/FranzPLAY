import { describe, expect, it } from "vitest";
import { isGood } from "./connection";

describe("isGood", () => {
  it.each([
    ["the browser does not say (Safari, Firefox)", undefined, true],
    ["fast Wi-Fi", { effectiveType: "4g", downlink: 10 }, true],
    ["fast, speed not known", { effectiveType: "4g" }, true],
    ["the person asked to save data", { saveData: true, effectiveType: "4g", downlink: 10 }, false],
    ["3g", { effectiveType: "3g", downlink: 1.5 }, false],
    ["slow 2g", { effectiveType: "slow-2g" }, false],
    ["4g but slow", { effectiveType: "4g", downlink: 2 }, false],
    ["just fast enough", { effectiveType: "4g", downlink: 5 }, true],
  ])("%s", (_, connection, want) => {
    expect(isGood(connection)).toBe(want);
  });
});
