// The administrator's rules that turn the names of video files into the
// titles people see: "Il_mio_video_[1080p].mp4" becomes "Il mio video".
// The files are never renamed; a title written by hand always wins.

import { request } from "./client";

export type TitleRule = {
  find: string;
  replace: string;
  regex: boolean; // find is a regular expression (Go's syntax), replace may use $1
  on: boolean;
};

export type TitleSettings = {
  rules: TitleRule[]; // applied one after the other, in this order
  categories: boolean; // the rules clean the names of the category folders too
};

export type TitlePreset = { name: string; rule: TitleRule };

// TitleExample is a real video of the folders, to try the rules on.
export type TitleExample = { file: string; folder: string };

export type TitleRulesPage = {
  settings: TitleSettings;
  presets: TitlePreset[];
  examples: TitleExample[];
};

// The limits the server checks.
export const maxRules = 30;
export const maxFind = 200;

function object(data: unknown, what: string): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`title rules: ${what} is not an object`);
  }
  return data as Record<string, unknown>;
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string") throw new Error(`title rules: bad ${what}`);
  return value;
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`title rules: ${what} is not a list`);
  return value;
}

function parseRule(data: unknown): TitleRule {
  const r = object(data, "rule");
  if (typeof r.regex !== "boolean" || typeof r.on !== "boolean") {
    throw new Error("title rules: bad rule");
  }
  return {
    find: text(r.find, "find"),
    replace: text(r.replace, "replace"),
    regex: r.regex,
    on: r.on,
  };
}

export function parseTitleSettings(data: unknown): TitleSettings {
  const s = object(data, "settings");
  return {
    rules: list(s.rules ?? [], "rules").map(parseRule),
    categories: s.categories === true,
  };
}

export function parseTitleRulesPage(data: unknown): TitleRulesPage {
  const p = object(data, "page");
  return {
    settings: parseTitleSettings(p.settings),
    presets: list(p.presets, "presets").map((item) => {
      const x = object(item, "preset");
      return { name: text(x.name, "preset name"), rule: parseRule(x.rule) };
    }),
    examples: list(p.examples, "examples").map((item) => {
      const x = object(item, "example");
      return { file: text(x.file, "file"), folder: text(x.folder, "folder") };
    }),
  };
}

export async function fetchTitleRules(signal?: AbortSignal): Promise<TitleRulesPage> {
  return parseTitleRulesPage(await request("/api/admin/title-rules", { signal }));
}

// previewTitles says what the rules, even unsaved, make of some file names
// and folder names. A wrong rule makes it fail with 400 and the reason.
export async function previewTitles(
  settings: TitleSettings,
  names: string[],
  folders: string[],
  signal?: AbortSignal,
): Promise<{ titles: string[]; folders: string[] }> {
  const p = object(
    await request("/api/admin/title-rules/preview", {
      method: "POST",
      body: { settings, names, folders },
      signal,
    }),
    "preview",
  );
  return {
    titles: list(p.titles, "titles").map((t) => text(t, "title")),
    folders: list(p.folders, "folders").map((t) => text(t, "folder")),
  };
}

// saveTitleRules saves the rules and makes the titles of every video again
// at once. It says how many videos changed.
export async function saveTitleRules(
  settings: TitleSettings,
): Promise<{ settings: TitleSettings; changed: number }> {
  const p = object(
    await request("/api/admin/title-rules", { method: "PUT", body: settings }),
    "saved",
  );
  if (typeof p.changed !== "number") throw new Error("title rules: bad changed");
  return { settings: parseTitleSettings(p.settings), changed: p.changed };
}
