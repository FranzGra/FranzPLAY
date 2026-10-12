// The player's decisions, as plain functions: no video element, no screen.
// The Player component asks these what to do, and they are easy to test.

// skipSeconds is how far the ±10 buttons, the keys and double taps jump.
export const skipSeconds = 10;

// speeds are the playback speeds offered in the settings menu.
export const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

// clampTime keeps a time inside the video.
export function clampTime(time: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) {
    return Math.max(0, time);
  }
  return Math.min(Math.max(0, time), duration);
}

// timeAt converts a point on the timeline to a time in the video.
// x is where the pointer is, left and width are the timeline's.
export function timeAt(x: number, left: number, width: number, duration: number): number {
  if (width <= 0 || !Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  const fraction = Math.min(Math.max((x - left) / width, 0), 1);
  return fraction * duration;
}

// previewFrame finds, in the image of previews, the frame for a time: its
// top-left corner in pixels. The last frame covers the end of the video.
export function previewFrame(
  preview: { gap: number; count: number; columns: number; width: number; height: number },
  time: number,
): { x: number; y: number } {
  const index = Math.min(Math.max(Math.floor(time / preview.gap), 0), preview.count - 1);
  return {
    x: (index % preview.columns) * preview.width,
    y: Math.floor(index / preview.columns) * preview.height,
  };
}

// bufferedEnd is how far the browser has downloaded ahead of time: the
// end of the downloaded range that contains time.
export function bufferedEnd(ranges: { start: number; end: number }[], time: number): number {
  for (const r of ranges) {
    if (time >= r.start && time <= r.end) {
      return r.end;
    }
  }
  return time;
}

// Action is something the person asks the player to do.
export type Action =
  | { kind: "toggle-play" }
  | { kind: "seek-by"; seconds: number }
  | { kind: "seek-to-fraction"; fraction: number }
  | { kind: "volume-by"; amount: number }
  | { kind: "toggle-mute" }
  | { kind: "toggle-fullscreen" }
  | { kind: "toggle-subtitles" };

// keyAction decides what a key does, as on YouTube. null: the key is not
// the player's, and the browser should handle it as usual.
export function keyAction(key: string): Action | null {
  switch (key) {
    case " ":
    case "k":
    case "K":
      return { kind: "toggle-play" };
    case "ArrowLeft":
    case "j":
    case "J":
      return { kind: "seek-by", seconds: -skipSeconds };
    case "ArrowRight":
    case "l":
    case "L":
      return { kind: "seek-by", seconds: skipSeconds };
    case "ArrowUp":
      return { kind: "volume-by", amount: 0.1 };
    case "ArrowDown":
      return { kind: "volume-by", amount: -0.1 };
    case "m":
    case "M":
      return { kind: "toggle-mute" };
    case "f":
    case "F":
      return { kind: "toggle-fullscreen" };
    case "c":
    case "C":
      return { kind: "toggle-subtitles" };
    case "Home":
      return { kind: "seek-to-fraction", fraction: 0 };
    case "End":
      return { kind: "seek-to-fraction", fraction: 1 };
  }
  if (key.length === 1 && key >= "0" && key <= "9") {
    // 0 = start, 5 = half, 9 = 90%: like YouTube.
    return { kind: "seek-to-fraction", fraction: Number(key) / 10 };
  }
  return null;
}

// tapZone decides what a double tap does on a touch screen: the left third
// goes back, the right third goes forward, the middle does nothing more.
export function tapZone(x: number, left: number, width: number): "back" | "forward" | "middle" {
  const fraction = width > 0 ? (x - left) / width : 0.5;
  if (fraction < 1 / 3) return "back";
  if (fraction > 2 / 3) return "forward";
  return "middle";
}

// clampVolume keeps the volume between 0 and 1, rounded to avoid
// 0.30000000000000004.
export function clampVolume(volume: number): number {
  return Math.round(Math.min(Math.max(volume, 0), 1) * 100) / 100;
}

// speedLabel writes a speed as in the menu: "Normale", "1,5×".
export function speedLabel(speed: number): string {
  return speed === 1 ? "Normale" : `${String(speed).replace(".", ",")}×`;
}

// insideRanges says whether time is in one of the downloaded ranges.
export function insideRanges(ranges: { start: number; end: number }[], time: number): boolean {
  return ranges.some((r) => time >= r.start && time <= r.end);
}

// originalAudio is the sound track the browser plays by itself: the one
// the file marks as default, or else the first.
export function originalAudio<T extends { default: boolean }>(tracks: T[]): T | undefined {
  return tracks.find((t) => t.default) ?? tracks[0];
}

// pickAudio chooses the sound track to play when a video opens: the
// language chosen last time if the video has it, else the original one.
export function pickAudio<T extends { stream: number; lang: string; default: boolean }>(
  tracks: T[],
  lang: string,
): number | null {
  const base = (l: string) => l.toLowerCase().split("-")[0];
  const same =
    lang === ""
      ? undefined
      : (tracks.find((t) => t.lang === lang) ?? tracks.find((t) => base(t.lang) === base(lang)));
  return (same ?? originalAudio(tracks))?.stream ?? null;
}
