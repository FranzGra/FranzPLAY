// Automatic subtitles: whisper writes them from the sound of a video, a
// translator turns them into other languages. Only the administrator asks.

import { request } from "./client";

export type SubtitlesSetup = {
  whisper: boolean; // whisper.cpp is installed
  models: string[]; // "small", "medium"
  translator: boolean; // a translator is set
  translatorError: string; // why it does not answer, "" when it does
  translatorLanguages: string[];
  languages: string[]; // what can be asked: "it", "en"…
  modelsFolder: string; // where the models go
};

export type SubtitleSource = "file" | "inside" | "auto";

export type VideoSubtitle = {
  lang: string; // "" when the file does not say
  source: SubtitleSource;
  from: string; // for a translation, the language it came from
};

export type SubtitleStage = "" | "audio" | "transcribe" | "translate";
export type JobState = "" | "pending" | "running" | "done" | "failed";

export type SubtitleRequest = {
  spoken: string; // "" = whisper guesses
  model: string;
  translate: string[];
  stage: SubtitleStage;
  state: JobState;
  error: string;
  at: Date;
};

export type SubtitledVideo = {
  id: number;
  title: string;
  cover: string | null;
  subtitles: VideoSubtitle[];
  request: SubtitleRequest | null;
};

export type SubtitlesHave = "" | "with" | "without";

function strings(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new Error(`${what}: not a list of text`);
  }
  return value;
}

export function parseSetup(data: unknown): SubtitlesSetup {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.whisper !== "boolean" || typeof d.translator !== "boolean") {
    throw new Error("subtitles setup: bad whisper or translator");
  }
  if (typeof d.translatorError !== "string" || typeof d.modelsFolder !== "string") {
    throw new Error("subtitles setup: bad text");
  }
  return {
    whisper: d.whisper,
    models: strings(d.models, "models"),
    translator: d.translator,
    translatorError: d.translatorError,
    translatorLanguages: strings(d.translatorLanguages, "translatorLanguages"),
    languages: strings(d.languages, "languages"),
    modelsFolder: d.modelsFolder,
  };
}

const sources: readonly SubtitleSource[] = ["file", "inside", "auto"];
const stages: readonly SubtitleStage[] = ["", "audio", "transcribe", "translate"];
const states: readonly JobState[] = ["", "pending", "running", "done", "failed"];

function parseSubtitle(data: unknown): VideoSubtitle {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.lang !== "string" || typeof d.from !== "string")
    throw new Error("subtitle: bad text");
  if (!sources.includes(d.source as SubtitleSource)) throw new Error("subtitle: bad source");
  return { lang: d.lang, source: d.source as SubtitleSource, from: d.from };
}

function parseRequest(data: unknown): SubtitleRequest {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.spoken !== "string" || typeof d.model !== "string" || typeof d.error !== "string") {
    throw new Error("subtitle request: bad text");
  }
  if (!stages.includes(d.stage as SubtitleStage)) throw new Error("subtitle request: bad stage");
  if (!states.includes(d.state as JobState)) throw new Error("subtitle request: bad state");
  const at = typeof d.at === "string" ? new Date(d.at) : new Date(Number.NaN);
  if (Number.isNaN(at.getTime())) throw new Error("subtitle request: bad date");
  return {
    spoken: d.spoken,
    model: d.model,
    translate: strings(d.translate, "translate"),
    stage: d.stage as SubtitleStage,
    state: d.state as JobState,
    error: d.error,
    at,
  };
}

export function parseSubtitledVideo(data: unknown): SubtitledVideo {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.id !== "number" || !Number.isInteger(d.id) || d.id <= 0) {
    throw new Error("subtitled video: bad id");
  }
  if (typeof d.title !== "string") throw new Error("subtitled video: bad title");
  if (d.cover !== null && typeof d.cover !== "string")
    throw new Error("subtitled video: bad cover");
  if (!Array.isArray(d.subtitles)) throw new Error("subtitled video: no subtitles list");
  return {
    id: d.id,
    title: d.title,
    cover: d.cover,
    subtitles: d.subtitles.map(parseSubtitle),
    request: d.request === null ? null : parseRequest(d.request),
  };
}

export async function fetchSubtitlesSetup(signal?: AbortSignal): Promise<SubtitlesSetup> {
  return parseSetup(await request("/api/admin/subtitles/setup", { signal }));
}

export async function fetchSubtitledVideos(
  options: { q?: string; have?: SubtitlesHave; lang?: string; limit: number },
  signal?: AbortSignal,
): Promise<{ videos: SubtitledVideo[]; total: number }> {
  const params = new URLSearchParams({ limit: String(options.limit) });
  if (options.q) params.set("q", options.q);
  if (options.have) params.set("have", options.have);
  if (options.lang) params.set("lang", options.lang);
  const data = await request(`/api/admin/subtitles?${params}`, { signal });
  const d = (data ?? {}) as Record<string, unknown>;
  if (!Array.isArray(d.videos)) throw new Error("subtitled videos: not a list");
  if (typeof d.total !== "number" || !Number.isInteger(d.total) || d.total < 0) {
    throw new Error("subtitled videos: bad total");
  }
  return { videos: d.videos.map(parseSubtitledVideo), total: d.total };
}

// askSubtitles asks whisper for the subtitles of a video, and their
// translations. It replaces what was asked before.
export async function askSubtitles(
  id: number,
  ask: { spoken: string; model: string; translate: string[] },
): Promise<void> {
  await request(`/api/admin/subtitles/${id}`, { method: "PUT", body: ask });
}

// takeBackSubtitles forgets what was asked for a video.
export async function takeBackSubtitles(id: number): Promise<void> {
  await request(`/api/admin/subtitles/${id}/request`, { method: "DELETE" });
}

// deleteMadeSubtitles deletes subtitles whisper made, in one language.
export async function deleteMadeSubtitles(id: number, lang: string): Promise<void> {
  await request(`/api/admin/subtitles/${id}/made/${encodeURIComponent(lang)}`, {
    method: "DELETE",
  });
}

// languageNames are the languages FranzPLAY names, in Italian.
const languageNames: Record<string, string> = {
  it: "Italiano",
  en: "Inglese",
  es: "Spagnolo",
  fr: "Francese",
  de: "Tedesco",
  pt: "Portoghese",
};

// languageName names a language for people: "Italiano", or the code.
export function languageName(code: string): string {
  return languageNames[code] ?? (code ? code.toUpperCase() : "Lingua non detta");
}
