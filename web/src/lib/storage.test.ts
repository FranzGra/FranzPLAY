import { loadSetting, saveSetting } from "./storage";

const parseNumber = (data: unknown) => {
  if (typeof data !== "number") throw new Error("not a number");
  return data;
};

describe("settings", () => {
  afterEach(() => window.localStorage.clear());

  it("remembers a value", () => {
    saveSetting("volume", 0.4);
    expect(loadSetting("volume", parseNumber, 1)).toBe(0.4);
  });

  it("uses the default when nothing is stored", () => {
    expect(loadSetting("volume", parseNumber, 1)).toBe(1);
  });

  it("uses the default when the stored value is damaged", () => {
    window.localStorage.setItem("franzplay.volume", "{not json");
    expect(loadSetting("volume", parseNumber, 1)).toBe(1);
    window.localStorage.setItem("franzplay.volume", '"loud"');
    expect(loadSetting("volume", parseNumber, 1)).toBe(1);
  });

  it("keeps working when the browser refuses to store", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => saveSetting("volume", 0.4)).not.toThrow();
    expect(loadSetting("volume", parseNumber, 1)).toBe(1);
  });
});
