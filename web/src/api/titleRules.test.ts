import { fakeServer } from "../test/render";
import {
  parseTitleRulesPage,
  parseTitleSettings,
  previewTitles,
  saveTitleRules,
} from "./titleRules";

const rule = { find: "_", replace: " ", regex: false, on: true };

describe("parseTitleSettings", () => {
  it("reads the rules in order", () => {
    const regex = { find: "\\[(\\d+)p\\]", replace: "$1", regex: true, on: false };
    expect(parseTitleSettings({ rules: [rule, regex], categories: true })).toEqual({
      rules: [rule, regex],
      categories: true,
    });
  });

  it("takes no rules and no categories as none", () => {
    expect(parseTitleSettings({})).toEqual({ rules: [], categories: false });
    expect(parseTitleSettings({ rules: null, categories: "yes" })).toEqual({
      rules: [],
      categories: false,
    });
  });

  it.each([
    ["not an object", null],
    ["a list", []],
    ["rules that are not a list", { rules: {} }],
    ["a rule without find", { rules: [{ ...rule, find: undefined }] }],
    ["a replace that is not text", { rules: [{ ...rule, replace: 0 }] }],
    ["regex as text", { rules: [{ ...rule, regex: "true" }] }],
    ["no on", { rules: [{ ...rule, on: undefined }] }],
  ])("refuses %s", (_label, data) => {
    expect(() => parseTitleSettings(data)).toThrow(/title rules/);
  });
});

describe("parseTitleRulesPage", () => {
  const page = {
    settings: { rules: [rule], categories: false },
    presets: [{ name: "Spazi", rule }],
    examples: [{ file: "Il_mare.mp4", folder: "" }],
  };

  it("reads the presets and the examples", () => {
    expect(parseTitleRulesPage(page)).toEqual(page);
  });

  it.each([
    ["no presets", { ...page, presets: undefined }],
    ["a preset without a name", { ...page, presets: [{ rule }] }],
    ["a preset with a bad rule", { ...page, presets: [{ name: "x", rule: {} }] }],
    ["no examples", { ...page, examples: null }],
    ["an example without a folder", { ...page, examples: [{ file: "a.mp4" }] }],
    ["no settings", { ...page, settings: undefined }],
  ])("refuses %s", (_label, data) => {
    expect(() => parseTitleRulesPage(data)).toThrow(/title rules/);
  });
});

describe("previewTitles", () => {
  it("sends the unsaved rules with the names to try", async () => {
    const { requests } = fakeServer({
      "POST /api/admin/title-rules/preview": {
        body: { titles: ["Il mare"], folders: ["Vacanze"] },
      },
    });
    const settings = { rules: [rule], categories: true };
    expect(await previewTitles(settings, ["Il_mare.mp4"], ["Vacanze"])).toEqual({
      titles: ["Il mare"],
      folders: ["Vacanze"],
    });
    expect(await requests[0]?.json()).toEqual({
      settings,
      names: ["Il_mare.mp4"],
      folders: ["Vacanze"],
    });
  });

  it("gives back the reason of a wrong rule", async () => {
    fakeServer({
      "POST /api/admin/title-rules/preview": {
        status: 400,
        body: { error: "rule 1: missing closing )" },
      },
    });
    await expect(previewTitles({ rules: [], categories: false }, [], [])).rejects.toMatchObject({
      status: 400,
      message: "rule 1: missing closing )",
    });
  });

  it.each([
    ["no titles", { folders: [] }],
    ["a title that is not text", { titles: [1], folders: [] }],
    ["no folders", { titles: [] }],
  ])("refuses an answer with %s", async (_label, body) => {
    fakeServer({ "POST /api/admin/title-rules/preview": { body } });
    await expect(previewTitles({ rules: [], categories: false }, [], [])).rejects.toThrow();
  });
});

describe("saveTitleRules", () => {
  it("says how many videos changed", async () => {
    const settings = { rules: [rule], categories: false };
    const { requests } = fakeServer({
      "PUT /api/admin/title-rules": { body: { settings, changed: 12 } },
    });
    expect(await saveTitleRules(settings)).toEqual({ settings, changed: 12 });
    expect(await requests[0]?.json()).toEqual(settings);
  });

  it("refuses an answer without the count", async () => {
    fakeServer({
      "PUT /api/admin/title-rules": { body: { settings: { rules: [] }, changed: "12" } },
    });
    await expect(saveTitleRules({ rules: [], categories: false })).rejects.toThrow(
      "title rules: bad changed",
    );
  });
});
