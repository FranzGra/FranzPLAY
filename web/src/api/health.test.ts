import { parseServerInfo } from "./health";

describe("parseServerInfo", () => {
  it("accepts a valid answer", () => {
    expect(parseServerInfo({ status: "ok", version: "1.2.3" })).toEqual({
      status: "ok",
      version: "1.2.3",
    });
  });

  it.each([
    ["null", null],
    ["a string", "ok"],
    ["a wrong status", { status: "down", version: "1" }],
    ["a missing version", { status: "ok" }],
    ["an empty version", { status: "ok", version: "" }],
    ["a number as version", { status: "ok", version: 3 }],
  ])("rejects %s", (_label, data) => {
    expect(() => parseServerInfo(data)).toThrow();
  });
});
