// Automatic subtitles: whisper writes them from the sound of a video, in the
// language spoken; a translator turns subtitles already written into other
// languages, without listening again. Two jobs. Only the administrator asks.

import { request } from "./client";

export type SubtitlesSetup = {
  whisper: boolean; // whisper.cpp is installed
  models: string[]; // "small", "medium"
  translator: boolean; // a translator is set
  translatorError: string; // why it does not answer, "" when it does
  translatorLanguages: string[];
  translatorHelp: TranslatorHelp;
  translatorModels: TranslatorModels | null; // null: it has no models of its own
  languages: string[]; // what can be asked: "it", "en"…
  modelsFolder: string; // where the models go
  downloadable: DownloadableModel[]; // what FranzPLAY can download by itself
  download: ModelDownload | null; // how the last download goes
};

// TranslatorHelp is what the translator's engine says of itself: the page
// shows these words and knows nothing of the engine.
export type TranslatorHelp = {
  off: string; // no translator set: what it takes to have one
  down: string; // it is set but does not answer: what to look at
  setup: string; // lines to copy to turn it on; "" when there are none
  after: string; // what happens then
};

// TranslatorModels are the models a translator downloads by itself, the first
// time they are needed. A model goes one way: "en-it".
export type TranslatorModels = {
  have: string[];
  name: string; // the one downloading; "" when none
  done: number; // bytes
  total: number; // bytes
};

export type DownloadableModel = { name: string; size: number; about: string };

export type ModelDownload = {
  name: string;
  done: number; // bytes
  total: number; // bytes, 0 = not known yet
  error: string;
  ended: boolean;
  // Newer servers only; an older answer gets false, null and 0.
  canceled: boolean; // the administrator stopped it
  startedAt: Date | null;
  endedAt: Date | null;
  speed: number; // bytes a second, on average since the start; 0 = not known
};

export type SubtitleSource = "file" | "inside" | "auto";

export type VideoSubtitle = {
  lang: string; // "" when the file does not say
  source: SubtitleSource;
  from: string; // for a translation, the language it came from
  model: string; // for whisper's, the model that wrote them; "" otherwise
};

export type SubtitleStage = "" | "audio" | "transcribe" | "translate";
export type JobState = "" | "pending" | "running" | "done" | "failed";

export type SubtitleRequest = {
  spoken: string; // "" = whisper guesses, as the administrator said
  model: string;
  translate: string[];
  stage: SubtitleStage;
  state: JobState;
  error: string;
  at: Date;
  // While whisper listens (state "running"), on newer servers; null otherwise.
  startedAt: Date | null;
  progress: number | null; // 0-100
  heardSeconds: number | null; // of the video
  totalSeconds: number | null;
};

// SubtitleTranslation is a translation asked and not finished.
export type SubtitleTranslation = {
  source: SubtitleSource; // the subtitles it starts from
  from: string; // their language
  to: string[];
  redo: boolean; // make again the ones already there
  state: JobState;
  error: string;
  at: Date;
  // While it runs; null otherwise, or not known yet.
  stage: string; // "translate"; "model" while it downloads what it needs
  startedAt: Date | null;
  progress: number | null; // 0-100
  done: number | null; // sentences, for all the languages together; or bytes of the download
  total: number | null;
};

export type SubtitledVideo = {
  id: number;
  title: string;
  cover: string | null;
  subtitles: VideoSubtitle[];
  request: SubtitleRequest | null;
  // Newer servers only; an older answer gets null and an empty list.
  translation: SubtitleTranslation | null;
  audioLangs: string[]; // of the sound tracks, as the file says: a hint
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
    translatorHelp: parseHelp(d.translatorHelp),
    translatorModels: parseTranslatorModels(d.translatorModels),
    languages: strings(d.languages, "languages"),
    modelsFolder: d.modelsFolder,
    downloadable: parseDownloadable(d.downloadable),
    download: d.download === null ? null : parseDownload(d.download),
  };
}

function parseHelp(data: unknown): TranslatorHelp {
  const d = (data ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return { off: text(d.off), down: text(d.down), setup: text(d.setup), after: text(d.after) };
}

function parseTranslatorModels(data: unknown): TranslatorModels | null {
  if (data === undefined || data === null) return null;
  const d = data as Record<string, unknown>;
  const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    have: strings(d.have, "translatorModels have"),
    name: typeof d.name === "string" ? d.name : "",
    done: count(d.done),
    total: count(d.total),
  };
}

function parseDownloadable(data: unknown): DownloadableModel[] {
  if (!Array.isArray(data)) throw new Error("downloadable: not a list");
  return data.map((m: unknown) => {
    const d = (m ?? {}) as Record<string, unknown>;
    if (typeof d.name !== "string" || typeof d.about !== "string" || typeof d.size !== "number") {
      throw new Error("downloadable: bad model");
    }
    return { name: d.name, size: d.size, about: d.about };
  });
}

function parseDownload(data: unknown): ModelDownload {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.name !== "string" || typeof d.error !== "string" || typeof d.ended !== "boolean") {
    throw new Error("download: bad text");
  }
  if (typeof d.done !== "number" || typeof d.total !== "number")
    throw new Error("download: bad size");
  return {
    name: d.name,
    done: d.done,
    total: d.total,
    error: d.error,
    ended: d.ended,
    canceled: d.canceled === true,
    startedAt: optionalDate(d.startedAt, "download startedAt"),
    endedAt: optionalDate(d.endedAt, "download endedAt"),
    speed: typeof d.speed === "number" && Number.isFinite(d.speed) ? d.speed : 0,
  };
}

function optionalDate(v: unknown, what: string): Date | null {
  if (v === undefined || v === null) return null;
  const d = typeof v === "string" ? new Date(v) : new Date(Number.NaN);
  if (Number.isNaN(d.getTime())) throw new Error(`${what}: bad date`);
  return d;
}

function optionalNumber(v: unknown, what: string): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${what}: not a number`);
  return v;
}

// downloadModel has FranzPLAY download a whisper model by itself.
export async function downloadModel(name: string): Promise<void> {
  await request(`/api/admin/subtitles/models/${encodeURIComponent(name)}`, { method: "POST" });
}

// cancelModelDownload stops the download going on and deletes what came
// so far. It fails (409) when nothing is downloading.
export async function cancelModelDownload(): Promise<void> {
  await request("/api/admin/subtitles/download", { method: "DELETE" });
}

const sources: readonly SubtitleSource[] = ["file", "inside", "auto"];
const stages: readonly SubtitleStage[] = ["", "audio", "transcribe", "translate"];
const states: readonly JobState[] = ["", "pending", "running", "done", "failed"];

function parseSubtitle(data: unknown): VideoSubtitle {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.lang !== "string" || typeof d.from !== "string")
    throw new Error("subtitle: bad text");
  if (!sources.includes(d.source as SubtitleSource)) throw new Error("subtitle: bad source");
  return {
    lang: d.lang,
    source: d.source as SubtitleSource,
    from: d.from,
    model: typeof d.model === "string" ? d.model : "",
  };
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
    startedAt: optionalDate(d.startedAt, "subtitle request startedAt"),
    progress: optionalNumber(d.progress, "subtitle request progress"),
    heardSeconds: optionalNumber(d.heardSeconds, "subtitle request heardSeconds"),
    totalSeconds: optionalNumber(d.totalSeconds, "subtitle request totalSeconds"),
  };
}

function parseTranslation(data: unknown): SubtitleTranslation {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.from !== "string" || typeof d.error !== "string" || typeof d.redo !== "boolean") {
    throw new Error("subtitle translation: bad text");
  }
  if (!sources.includes(d.source as SubtitleSource))
    throw new Error("subtitle translation: bad source");
  if (!states.includes(d.state as JobState)) throw new Error("subtitle translation: bad state");
  const at = optionalDate(d.at, "subtitle translation at");
  if (at === null) throw new Error("subtitle translation: no date");
  return {
    source: d.source as SubtitleSource,
    from: d.from,
    to: strings(d.to, "subtitle translation to"),
    redo: d.redo,
    state: d.state as JobState,
    error: d.error,
    at,
    stage: typeof d.stage === "string" ? d.stage : "",
    startedAt: optionalDate(d.startedAt, "subtitle translation startedAt"),
    progress: optionalNumber(d.progress, "subtitle translation progress"),
    done: optionalNumber(d.done, "subtitle translation done"),
    total: optionalNumber(d.total, "subtitle translation total"),
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
    translation:
      d.translation === undefined || d.translation === null
        ? null
        : parseTranslation(d.translation),
    audioLangs: d.audioLangs === undefined ? [] : strings(d.audioLangs, "audioLangs"),
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

// spokenUnknown is what to send when the administrator says they do not know
// the language spoken, and whisper has to guess.
export const spokenUnknown = "auto";

// askSubtitles asks whisper for the subtitles of a video, in the language
// spoken, and the translations to do afterwards. It replaces what was asked
// before.
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

// askTranslation asks to translate subtitles a video already has, without
// listening to it again.
export async function askTranslation(
  id: number,
  ask: { source: SubtitleSource; from: string; to: string[]; redo: boolean },
): Promise<void> {
  await request(`/api/admin/subtitles/${id}/translation`, { method: "PUT", body: ask });
}

// takeBackTranslation forgets the translation asked for a video.
export async function takeBackTranslation(id: number): Promise<void> {
  await request(`/api/admin/subtitles/${id}/translation`, { method: "DELETE" });
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

// mainLang is a language without its country: "en" from "en-US".
export function mainLang(code: string): string {
  return (code.split("-")[0] ?? code).toLowerCase();
}

// languageName names a language for people: "Italiano", or the code.
export function languageName(code: string): string {
  return (
    languageNames[code] ??
    languageNames[mainLang(code)] ??
    (code ? code.toUpperCase() : "Lingua non detta")
  );
}

// fromLanguage says where a translation comes from: "dall'inglese".
export function fromLanguage(code: string): string {
  const name = languageName(code).toLowerCase();
  if (!languageNames[mainLang(code)]) return `da ${code.toUpperCase()}`;
  if (/^[aeiou]/.test(name)) return `dall'${name}`;
  return name.startsWith("sp") ? `dallo ${name}` : `dal ${name}`;
}
