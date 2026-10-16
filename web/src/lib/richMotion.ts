import { savesData } from "./connection";

// richMotion says whether this device should get the big moves, like the
// cover of a video growing into the player. They are a gift, never
// needed: whoever asked for less motion or for less data, and phones or
// computers with little power or memory, get the plain page, which works
// the same. Browsers that do not say how strong they are count as strong.

// Device is what the browser tells about itself.
export type Device = {
  reducedMotion: boolean;
  saveData: boolean;
  cores?: number; // navigator.hardwareConcurrency
  memory?: number; // navigator.deviceMemory, in gigabytes (Chrome only)
};

// weakLimit is the most cores, or gigabytes of memory, of a weak device.
export const weakLimit = 2;

// isRich is richMotion's decision, on what the browser said.
export function isRich(device: Device): boolean {
  if (device.reducedMotion || device.saveData) return false;
  if (typeof device.cores === "number" && device.cores > 0 && device.cores <= weakLimit) {
    return false;
  }
  if (typeof device.memory === "number" && device.memory > 0 && device.memory <= weakLimit) {
    return false;
  }
  return true;
}

export function richMotion(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return isRich({
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    saveData: savesData(),
    cores: nav.hardwareConcurrency,
    memory: nav.deviceMemory,
  });
}

// canMorphPages says whether going from page to page may use the
// browser's view transitions: only where the browser has them, and only
// with richMotion.
export function canMorphPages(): boolean {
  return (
    typeof document !== "undefined" &&
    "startViewTransition" in document &&
    typeof document.startViewTransition === "function" &&
    richMotion()
  );
}
