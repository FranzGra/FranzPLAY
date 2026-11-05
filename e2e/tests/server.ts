import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import { PASSWORD, STATE_FILE } from "./franzplay";

// A FranzPLAY of one test only: its own port, its own data and a copy of a
// small library, started empty and stopped at the end of the test. What a
// test changes there (rules, shapes, subtitles, the administrator itself)
// never reaches another test, in any order and any number of times.

// The library of every such FranzPLAY: a folder holding only folders (a
// collector, no category), seasons with videos, names with underscores,
// tags and accents. global-setup makes it once; each server gets a copy.
export const LIBRARY = [
  { path: "Serie_Prova/Stagione_1/Episodio_01_[720p].webm", tone: 300 },
  { path: "Serie_Prova/Stagione_1/Episodio_02_[720p].webm", tone: 330 },
  { path: "Serie_Prova/Stagione_2/Città_di_notte.webm", tone: 360 },
  { path: "Documentari/Natura_è_bella.webm", tone: 390 },
] as const;
// Every video of LIBRARY lasts this long: enough to choose a moment, and a
// place to continue from (after the first tenth, before the last one).
export const SECONDS = 12;
export const FRESH_ADMIN = "Anna";

// makeVideo writes a short video the browser plays (VP9 picture, Opus sound).
// A different tone makes a different file: FranzPLAY keeps one copy only of
// the same video.
export function makeVideo(file: string, seconds: number, tone: number, size = "640x360") {
  mkdirSync(dirname(file), { recursive: true });
  const picture = `testsrc2=size=${size}:rate=25:duration=${seconds}`;
  const sound = `sine=frequency=${tone}:duration=${seconds}`;
  const args = `-v error -y -f lavfi -i ${picture} -f lavfi -i ${sound}
    -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 300k -g 50 -c:a libopus`;
  execFileSync("ffmpeg", [...args.split(/\s+/), file]);
}

// makeLibrary writes LIBRARY into folder.
export function makeLibrary(folder: string) {
  for (const v of LIBRARY) {
    makeVideo(join(folder, v.path), SECONDS, v.tone, "320x180");
  }
}

// program is the FranzPLAY to test: FRANZPLAY_BIN, or the one make build makes.
export function program(): string {
  return resolve(process.env.FRANZPLAY_BIN ?? "../bin/franzplay");
}

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => (typeof address === "object" && address ? ok(address.port) : fail()));
    });
  });
}

export type Running = { process: ChildProcess; base: string };

// launch starts FranzPLAY on a free port and waits for it to say, in its
// log, that it waits for its administrator (a new FranzPLAY always does).
export async function launch(dataDir: string, library: string, port?: number): Promise<Running> {
  const at = port ?? (await freePort());
  const server = spawn(program(), [], {
    env: {
      ...process.env,
      FRANZPLAY_ADDR: `127.0.0.1:${at}`,
      FRANZPLAY_DATA_DIR: dataDir,
      FRANZPLAY_LIBRARIES: library,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  await new Promise<void>((ok, fail) => {
    let log = "";
    const timer = setTimeout(() => fail(new Error(`FranzPLAY did not start:\n${log}`)), 20_000);
    const listen = (chunk: Buffer) => {
      log += chunk.toString();
      if (log.includes("no administrator yet")) {
        clearTimeout(timer);
        server.stderr?.off("data", listen);
        ok();
      }
    };
    server.stderr?.on("data", listen);
    server.on("exit", (status) => {
      clearTimeout(timer);
      fail(new Error(`FranzPLAY stopped (${status}):\n${log}`));
    });
  });
  server.stderr?.resume();
  // The log comes a moment before the server listens: ask until it answers.
  const address = `http://127.0.0.1:${at}`;
  await expect
    .poll(
      () =>
        fetch(`${address}/api/health`).then(
          (r) => r.ok,
          () => false,
        ),
      {
        timeout: 20_000,
      },
    )
    .toBe(true);
  return { process: server, base: address };
}

// stop ends FranzPLAY and waits until it is gone.
export async function stop(server: ChildProcess) {
  if (server.exitCode !== null || server.signalCode !== null) return;
  const gone = new Promise<void>((ok) => server.once("exit", () => ok()));
  server.kill("SIGTERM");
  const late = setTimeout(() => server.kill("SIGKILL"), 10_000);
  await gone;
  clearTimeout(late);
}

// post sends JSON to the API with the headers a browser would send.
export async function post(base: string, path: string, body: unknown, cookie = "") {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base, Cookie: cookie },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${path}: ${res.status} ${await res.text()}`);
  }
  return res;
}

// waitForJobs waits until covers, previews and clips are all made.
export async function waitForJobs(base: string, cookie: string, limit = 300_000) {
  const deadline = Date.now() + limit;
  for (;;) {
    const res = await fetch(`${base}/api/jobs`, { headers: { Cookie: cookie } });
    const jobs = (await res.json()) as { waiting: number; retrying: number; running: unknown };
    if (jobs.waiting === 0 && jobs.retrying === 0 && jobs.running === null) return;
    if (Date.now() > deadline) {
      throw new Error(`background jobs not finished: ${JSON.stringify(jobs)}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

export type Fresh = {
  base: string;
  library: string; // the library folder, to add files to
  cookie: string; // the administrator's session, "" without one
  // user creates a person with PASSWORD and the role given.
  user: (name: string, role?: "user" | "admin") => Promise<void>;
  // jobs waits for the work in the background (covers, previews, clips).
  jobs: () => Promise<void>;
};

type Options = { withAdmin: boolean };

// test is Playwright's test with fresh, a FranzPLAY of this test only, as the
// address of the pages. With withAdmin (the default) its administrator
// FRESH_ADMIN exists and the scan of the library is over; without, nobody
// exists yet and the first visitor creates the administrator.
export const test = base.extend<Options & { fresh: Fresh }>({
  withAdmin: [true, { option: true }],
  fresh: async ({ withAdmin }, use) => {
    const { template } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as { template: string };
    const root = mkdtempSync(join(tmpdir(), "franzplay-e2e-fresh-"));
    const library = join(root, "video");
    cpSync(template, library, { recursive: true });
    const running = await launch(join(root, "data"), library);
    const { base: at } = running;
    try {
      let cookie = "";
      if (withAdmin) {
        const setup = await post(at, "/api/setup", { name: FRESH_ADMIN, password: PASSWORD });
        cookie = (setup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
        // The first scan runs as FranzPLAY starts: wait for every video.
        await expect
          .poll(
            async () => {
              const res = await fetch(`${at}/api/videos`, { headers: { Cookie: cookie } });
              return ((await res.json()) as { videos: unknown[] }).videos.length;
            },
            { timeout: 30_000 },
          )
          .toBe(LIBRARY.length);
      }
      await use({
        base: at,
        library,
        cookie,
        user: async (name, role = "user") => {
          await post(at, "/api/users", { name, password: PASSWORD, role, canUpload: true }, cookie);
        },
        jobs: () => waitForJobs(at, cookie),
      });
    } finally {
      await stop(running.process);
      rmSync(root, { recursive: true, force: true });
    }
  },
  baseURL: async ({ fresh }, use) => use(fresh.base),
});

export { expect };

// enter logs the page's browser in, through the API, on the server of base.
export async function enter(page: Page, base: string, name: string) {
  const res = await page.request.post(`${base}/api/login`, {
    data: { name, password: PASSWORD },
    headers: { Origin: base },
  });
  expect(res.ok()).toBe(true);
}

// send calls the API from the page's browser, with its session.
export async function send(
  page: Page,
  base: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  data?: unknown,
) {
  const res = await page.request.fetch(base + path, {
    method,
    data,
    headers: { Origin: base },
  });
  expect(res.ok(), `${method} ${path}: ${res.status()}`).toBe(true);
  return res;
}

type AdminVideo = {
  id: number;
  title: string;
  path: string;
  duration: number | null;
  cover: string | null;
  clip: string | null;
  coverChoice: string;
  coverSecond: number | null;
  clipSecond: number | null;
};

// adminVideos lists every video as the administration sees it.
export async function adminVideos(page: Page, base: string): Promise<AdminVideo[]> {
  const res = await send(page, base, "GET", "/api/admin/videos?limit=100");
  return ((await res.json()) as { videos: AdminVideo[] }).videos;
}

// adminVideo is the video of LIBRARY whose file ends with name.
export async function adminVideo(page: Page, base: string, name: string): Promise<AdminVideo> {
  const all = await adminVideos(page, base);
  const found = all.find((v) => v.path.endsWith(name));
  if (!found) throw new Error(`no video ${name} in ${all.map((v) => v.path).join(", ")}`);
  return found;
}

// pageFits says whether nothing makes the page wider than its window.
export async function pageFits(page: Page): Promise<{ width: number; scroll: number }> {
  return page.evaluate(() => ({
    width: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
}

// mediaSeconds is how long a video sent by the server lasts, as ffprobe reads it.
export async function mediaSeconds(page: Page, base: string, path: string): Promise<number> {
  const res = await page.request.get(base + path);
  expect(res.ok(), `GET ${path}: ${res.status()}`).toBe(true);
  const work = mkdtempSync(join(tmpdir(), "franzplay-e2e-probe-"));
  try {
    const file = join(work, "clip");
    writeFileSync(file, await res.body());
    const out = execFileSync("ffprobe", [
      ...["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    ]);
    return Number.parseFloat(out.toString());
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
