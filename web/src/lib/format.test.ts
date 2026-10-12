import {
  formatAge,
  formatDate,
  formatDay,
  formatDuration,
  formatSince,
  formatVideos,
} from "./format";

describe("formatDuration", () => {
  it.each([
    [0, "0:00"],
    [42, "0:42"],
    [245, "4:05"],
    [599.9, "9:59"],
    [3600, "1:00:00"],
    [3723, "1:02:03"],
    [-5, "0:00"],
  ])("%d seconds is %s", (seconds, want) => {
    expect(formatDuration(seconds)).toBe(want);
  });
});

describe("formatAge", () => {
  const now = new Date(2026, 9, 12, 9, 0);
  it.each([
    [new Date(2026, 9, 12, 0, 1), "oggi"],
    [new Date(2026, 9, 13, 0, 1), "oggi"], // a clock a bit ahead
    [new Date(2026, 9, 11, 23, 59), "ieri"],
    [new Date(2026, 9, 9), "3 giorni fa"],
    [new Date(2026, 9, 5), "1 settimana fa"],
    [new Date(2026, 8, 25), "2 settimane fa"],
    [new Date(2026, 8, 10), "1 mese fa"],
    [new Date(2026, 4, 1), "5 mesi fa"],
    [new Date(2025, 9, 1), "1 anno fa"],
    [new Date(2020, 0, 1), "6 anni fa"],
  ])("%s is %s", (date, want) => {
    expect(formatAge(date, now)).toBe(want);
  });
});

describe("formatVideos", () => {
  it.each([
    [1, "1 video"],
    [12, "12 video"],
    [12345, "12.345 video"],
  ])("%d", (n, want) => {
    expect(formatVideos(n)).toBe(want);
  });
});

describe("formatDay", () => {
  const now = new Date(2026, 9, 12, 15, 0); // Monday 12 October 2026
  it.each([
    [new Date(2026, 9, 12, 0, 5), "Oggi"],
    [new Date(2026, 9, 11, 23, 59), "Ieri"],
    [new Date(2026, 9, 8, 10, 0), "Giovedì"],
    [new Date(2026, 9, 5, 10, 0), "5 ottobre"],
    [new Date(2025, 11, 24, 10, 0), "24 dicembre 2025"],
  ])("names %s", (date, want) => {
    expect(formatDay(date, now)).toBe(want);
  });
});

describe("formatSince", () => {
  const now = new Date(2026, 9, 12, 9, 0);
  it.each([
    [new Date(2026, 9, 12, 8, 59, 30), "adesso"],
    [new Date(2026, 9, 12, 9, 1), "adesso"], // a clock a bit ahead
    [new Date(2026, 9, 12, 8, 59), "1 minuto fa"],
    [new Date(2026, 9, 12, 8, 15), "45 minuti fa"],
    [new Date(2026, 9, 12, 8, 0), "1 ora fa"],
    [new Date(2026, 9, 11, 12, 0), "21 ore fa"],
    [new Date(2026, 9, 11, 8, 0), "ieri"],
    [new Date(2026, 9, 9), "3 giorni fa"],
  ])("%s is %s", (date, want) => {
    expect(formatSince(date, now)).toBe(want);
  });
});

describe("formatDate", () => {
  it("writes the day in full", () => {
    expect(formatDate(new Date(2019, 2, 15))).toBe("15 marzo 2019");
  });
});
