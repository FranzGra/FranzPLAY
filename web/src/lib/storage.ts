// Small settings remembered by this browser (volume, subtitle style…).
// The browser may refuse to store anything (private windows, blocked site
// data): then the defaults are used and nothing breaks.

export function loadSetting<T>(key: string, parse: (data: unknown) => T, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(`franzplay.${key}`);
    return raw === null ? fallback : parse(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

export function saveSetting(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(`franzplay.${key}`, JSON.stringify(value));
  } catch {
    // Not stored: the setting lasts until the page is closed. Nothing else to do.
  }
}
