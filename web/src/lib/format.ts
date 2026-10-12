// Numbers and dates written the way people read them, in Italian.

// formatDuration writes seconds as on YouTube: "0:42", "4:05", "1:02:03".
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

const day = 24 * 60 * 60 * 1000;

// formatAge says how long ago something happened: "oggi", "ieri",
// "3 giorni fa", "2 settimane fa", "5 mesi fa", "1 anno fa".
export function formatAge(date: Date, now: Date): string {
  const days = Math.floor((startOfDay(now) - startOfDay(date)) / day);
  if (days <= 0) return "oggi";
  if (days === 1) return "ieri";
  if (days < 7) return `${days} giorni fa`;
  if (days < 30) return plural(Math.floor(days / 7), "settimana", "settimane");
  if (days < 365) return plural(Math.floor(days / 30), "mese", "mesi");
  return plural(Math.floor(days / 365), "anno", "anni");
}

// formatSince is formatAge with the hours of today, for things written
// a moment ago like comments: "adesso", "5 minuti fa", "3 ore fa", then
// "ieri", "3 giorni fa"…
export function formatSince(date: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "adesso";
  if (minutes < 60) return plural(minutes, "minuto", "minuti");
  if (minutes < 24 * 60) return plural(Math.floor(minutes / 60), "ora", "ore");
  return formatAge(date, now);
}

// formatDay names a day for a list grouped by day, like the history:
// "Oggi", "Ieri", "Lunedì" within a week, then "12 ottobre", and
// "12 ottobre 2025" for another year.
export function formatDay(date: Date, now: Date): string {
  const days = Math.floor((startOfDay(now) - startOfDay(date)) / day);
  if (days <= 0) return "Oggi";
  if (days === 1) return "Ieri";
  const options: Intl.DateTimeFormatOptions =
    days < 7
      ? { weekday: "long" }
      : date.getFullYear() === now.getFullYear()
        ? { day: "numeric", month: "long" }
        : { day: "numeric", month: "long", year: "numeric" };
  const text = date.toLocaleDateString("it-IT", options);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many} fa`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// formatVideos writes "1 video" or "12 video" (the Italian word does not
// change), with thousands separated as in Italian: "12.345 video".
export function formatVideos(n: number): string {
  return `${n.toLocaleString("it-IT")} video`;
}
