// The player's decisions, as plain functions: no video element, no screen.
// The Player component asks these what to do, and they are easy to test.

// skipSeconds is how far the ±15 buttons, the keys and double taps jump.
// 15: a bit more than YouTube's 10.
export const skipSeconds = 15;

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

// previewFrame finds, in the image of previews, the frame for a time, as
// CSS background values in percent: the frame is shown at whatever size
// the player chooses, whatever size it was made at. The last frame covers
// the end of the video.
export function previewFrame(
  preview: { gap: number; count: number; columns: number },
  time: number,
): { position: string; size: string } {
  const index = Math.min(Math.max(Math.floor(time / preview.gap), 0), preview.count - 1);
  const rows = Math.ceil(preview.count / preview.columns);
  // In CSS, 0% puts the image's left edge on the box's left edge and 100%
  // its right edge on the right one: frame i of n is at i / (n - 1).
  const percent = (i: number, n: number) => (n > 1 ? (i / (n - 1)) * 100 : 0);
  const x = percent(index % preview.columns, preview.columns);
  const y = percent(Math.floor(index / preview.columns), rows);
  return {
    position: `${round(x)}% ${round(y)}%`,
    size: `${preview.columns * 100}% ${rows * 100}%`,
  };
}

// round keeps 4 decimals: enough for a frame among thousands of pixels.
function round(n: number): number {
  return Math.round(n * 10000) / 10000;
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
  | { kind: "toggle-theater" }
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
    case "t":
    case "T":
      return { kind: "toggle-theater" };
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

// wheelStep is how much one notch of the mouse wheel over the volume
// changes it: 5 %, the same step as the volume bar.
export const wheelStep = 0.05;
// wheelNotch is how far the wheel moves the page with one notch, in pixels.
const wheelNotch = 100;
// lineHeight turns a wheel that counts in lines (Firefox) into pixels.
const lineHeight = 33;

// wheelVolume turns the wheel over the volume into whole steps up (+) or
// down (-), keeping what is left for the next turn: a touchpad sends many
// small moves, a mouse one big move per notch. deltaMode 1 counts in lines,
// 2 in pages.
export function wheelVolume(
  rest: number,
  deltaY: number,
  deltaMode: number,
): { steps: number; rest: number } {
  const pixels =
    deltaMode === 1 ? deltaY * lineHeight : deltaMode === 2 ? deltaY * wheelNotch : deltaY;
  const total = rest - pixels; // the wheel turned away from you scrolls up: louder
  const steps = Math.trunc(total / wheelNotch) || 0; // never -0
  return { steps, rest: total - steps * wheelNotch };
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

// NativeAudioTrack is a sound track the browser itself can switch on and
// off (HTMLMediaElement.audioTracks): Safari can, Chrome and Firefox not.
export type NativeAudioTrack = { enabled: boolean };

// nativeAudio returns the sound tracks the browser can switch by itself,
// or null when it cannot. Browsers that can have AudioTrackList; others
// may still have an empty audioTracks that does nothing.
export function nativeAudio(v: HTMLVideoElement): ArrayLike<NativeAudioTrack> | null {
  if (!("AudioTrackList" in window)) return null;
  return (v as { audioTracks?: ArrayLike<NativeAudioTrack> }).audioTracks ?? null;
}
