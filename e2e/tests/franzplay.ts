import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

export const BASE = "http://127.0.0.1:8091";
export const ADMIN = "Paolo";
export const PEOPLE = ["Giulia"];
export const PASSWORD = "password-lunga-123";
// Where global-setup leaves what global-teardown needs.
export const STATE_FILE = join(tmpdir(), "franzplay-e2e.json");

// logIn starts a session in the page's browser, through the API.
export async function logIn(page: Page, name: string) {
  const res = await page.request.post("/api/login", {
    data: { name, password: PASSWORD },
    headers: { Origin: BASE },
  });
  expect(res.ok()).toBe(true);
}

// watchErrors collects what goes wrong in the page: errors in the code,
// failed requests to the server, and any request that leaves the machine
// (a font or a script from the internet): FranzPLAY must work offline.
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    const url = new URL(r.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin !== BASE) {
      errors.push(`request outside FranzPLAY: ${r.url()}`);
    }
  });
  page.on("console", (m) => {
    // Opening another address cuts short the requests still on their way,
    // like the last saved position (sent with keepalive, so the server
    // still gets it: see video.spec.ts). That is the test jumping, not a
    // fault of the page.
    if (m.type() === "error" && !m.text().startsWith("TypeError: Failed to fetch")) {
      errors.push(m.text());
    }
  });
  return errors;
}

type Video = { id: number; title: string; duration: number | null };

// videos lists the videos as the API sees them.
export async function videos(page: Page): Promise<Video[]> {
  const res = await page.request.get("/api/videos");
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { videos: Video[] }).videos;
}
