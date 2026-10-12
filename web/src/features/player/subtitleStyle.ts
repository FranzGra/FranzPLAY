import type { CSSProperties } from "react";

// How subtitles look. Each person chooses in the player's settings, and
// the browser remembers it.
export type SubtitleStyle = {
  size: "small" | "normal" | "large" | "huge";
  color: "white" | "yellow" | "cyan" | "green";
  background: "none" | "shadow" | "translucent" | "black";
  position: "bottom" | "top";
};

export const defaultSubtitleStyle: SubtitleStyle = {
  size: "normal",
  color: "white",
  background: "translucent",
  position: "bottom",
};

type Option<K extends keyof SubtitleStyle> = { value: SubtitleStyle[K]; label: string };

// subtitleOptions are the choices offered, in the order shown.
export const subtitleOptions: {
  [K in keyof SubtitleStyle]: { title: string; options: Option<K>[] };
} = {
  size: {
    title: "Dimensione",
    options: [
      { value: "small", label: "Piccola" },
      { value: "normal", label: "Normale" },
      { value: "large", label: "Grande" },
      { value: "huge", label: "Molto grande" },
    ],
  },
  color: {
    title: "Colore",
    options: [
      { value: "white", label: "Bianco" },
      { value: "yellow", label: "Giallo" },
      { value: "cyan", label: "Azzurro" },
      { value: "green", label: "Verde" },
    ],
  },
  background: {
    title: "Sfondo",
    options: [
      { value: "none", label: "Nessuno" },
      { value: "shadow", label: "Solo ombra" },
      { value: "translucent", label: "Semitrasparente" },
      { value: "black", label: "Nero" },
    ],
  },
  position: {
    title: "Posizione",
    options: [
      { value: "bottom", label: "In basso" },
      { value: "top", label: "In alto" },
    ],
  },
};

export const styleKeys = ["size", "color", "background", "position"] as const;

export function optionLabel<K extends keyof SubtitleStyle>(
  key: K,
  value: SubtitleStyle[K],
): string {
  return subtitleOptions[key].options.find((o) => o.value === value)?.label ?? "";
}

// parseSubtitleStyle checks a style remembered by the browser: anything
// unknown goes back to the default.
export function parseSubtitleStyle(data: unknown): SubtitleStyle {
  const stored = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const pick = <K extends keyof SubtitleStyle>(key: K): SubtitleStyle[K] => {
    const found = subtitleOptions[key].options.find((o) => o.value === stored[key]);
    return found ? found.value : defaultSubtitleStyle[key];
  };
  return {
    size: pick("size"),
    color: pick("color"),
    background: pick("background"),
    position: pick("position"),
  };
}

// Sizes are a share of the player's height (cqh), so subtitles grow with
// the player and stay readable in full screen.
const sizes: Record<SubtitleStyle["size"], string> = {
  small: "4cqh",
  normal: "5.5cqh",
  large: "7cqh",
  huge: "9cqh",
};

const colors: Record<SubtitleStyle["color"], string> = {
  white: "#ffffff",
  yellow: "#ffe14d",
  cyan: "#5ce1ff",
  green: "#6dff8a",
};

const backgrounds: Record<SubtitleStyle["background"], string> = {
  none: "transparent",
  shadow: "transparent",
  translucent: "rgb(0 0 0 / 0.6)",
  black: "#000000",
};

// subtitleCSS turns a style into the look of a subtitle line.
export function subtitleCSS(style: SubtitleStyle): CSSProperties {
  return {
    fontSize: `max(14px, ${sizes[style.size]})`,
    color: colors[style.color],
    backgroundColor: backgrounds[style.background],
    textShadow:
      style.background === "shadow" ? "0 0 4px #000, 0 0 2px #000, 0 2px 4px #000" : "none",
  };
}

// cueLines turns the text of a subtitle cue into plain lines: the tags of
// WebVTT (<i>, <b>, <c.color>, <v Name>) are dropped, never shown as HTML.
export function cueLines(text: string): string[] {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

// linesAt returns the lines of the subtitles to show at time, in seconds
// of the whole video.
export function linesAt(
  cues: ArrayLike<{ startTime: number; endTime: number; text?: string }>,
  time: number,
): string[] {
  const lines: string[] = [];
  for (const cue of Array.from(cues)) {
    if (time >= cue.startTime && time < cue.endTime) lines.push(...cueLines(cue.text ?? ""));
  }
  return lines;
}
