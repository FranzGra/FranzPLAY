import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ADMIN, BASE, PASSWORD, PEOPLE, STATE_FILE } from "./tests/franzplay";

// makeVideo writes a short video the browser plays (VP9 picture, Opus sound).
function makeVideo(file: string, seconds: number, tone: number) {
  const picture = `testsrc2=size=640x360:rate=25:duration=${seconds}`;
  const sound = `sine=frequency=${tone}:duration=${seconds}`;
  const args = `-v error -y -f lavfi -i ${picture} -f lavfi -i ${sound}
    -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 400k -g 50 -c:a libopus`;
  execFileSync("ffmpeg", [...args.split(/\s+/), file]);
}

async function api(path: string, body: unknown, cookie = ""): Promise<Response> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: BASE,
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${path}: ${res.status} ${await res.text()}`);
  }
  return res;
}

export default async function globalSetup() {
  const root = mkdtempSync(join(tmpdir(), "franzplay-e2e-"));
  const library = join(root, "video");
  for (const folder of ["Vacanze", "Corsi"]) {
    mkdirSync(join(library, folder), { recursive: true });
  }
  makeVideo(join(library, "Vacanze", "Gita al mare.webm"), 40, 440);
  makeVideo(join(library, "Vacanze", "Montagna d'inverno.webm"), 20, 550);
  makeVideo(join(library, "Corsi", "Lezione 1.webm"), 30, 660);
  // Enough videos for the Home rows to scroll sideways: a few bytes at the
  // end make each copy a different video for FranzPLAY.
  for (let i = 2; i <= 12; i++) {
    const copy = join(library, "Corsi", `Lezione ${i}.webm`);
    copyFileSync(join(library, "Vacanze", "Montagna d'inverno.webm"), copy);
    appendFileSync(copy, `copy ${i}`);
  }
  writeFileSync(
    join(library, "Corsi", "Lezione 1.it.vtt"),
    "WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nCiao a tutti\n",
  );

  const program = resolve(process.env.FRANZPLAY_BIN ?? "../bin/franzplay");
  const server = spawn(program, [], {
    env: {
      ...process.env,
      FRANZPLAY_ADDR: "127.0.0.1:8091",
      FRANZPLAY_DATA_DIR: join(root, "data"),
      FRANZPLAY_LIBRARIES: library,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  // The setup code for the administrator is written in the log.
  const code = await new Promise<string>((ok, fail) => {
    let log = "";
    const timer = setTimeout(() => fail(new Error(`FranzPLAY did not start:\n${log}`)), 20_000);
    server.stderr.on("data", (chunk: Buffer) => {
      log += chunk.toString();
      const found = /setup_code=(\S+)/.exec(log);
      if (found) {
        clearTimeout(timer);
        ok(found[1]);
      }
    });
    server.on("exit", (status) => fail(new Error(`FranzPLAY stopped (${status}):\n${log}`)));
  });
  server.stderr.resume();
  writeFileSync(STATE_FILE, JSON.stringify({ pid: server.pid, root }));

  const setup = await api("/api/setup", {
    code,
    name: ADMIN,
    password: PASSWORD,
  });
  const cookie = (setup.headers.get("set-cookie") ?? "").split(";")[0];
  for (const name of PEOPLE) {
    await api("/api/users", { name, password: PASSWORD, role: "user", canUpload: true }, cookie);
  }

  // Likes, so the cards show their count (and the "Ti piacciono" row).
  const all = await fetch(`${BASE}/api/videos`, { headers: { Cookie: cookie } });
  const { videos } = (await all.json()) as { videos: { id: number }[] };
  for (const v of videos.slice(0, 8)) {
    const res = await fetch(`${BASE}/api/videos/${v.id}/like`, {
      method: "PUT",
      headers: { Origin: BASE, Cookie: cookie },
    });
    if (!res.ok) {
      throw new Error(`like video ${v.id}: ${res.status}`);
    }
  }

  // Covers, previews and clips are made in the background: wait for them,
  // so every page shows what people really see.
  const deadline = Date.now() + 120_000;
  for (;;) {
    const res = await fetch(`${BASE}/api/jobs`, {
      headers: { Cookie: cookie },
    });
    const jobs = (await res.json()) as {
      waiting: number;
      retrying: number;
      running: unknown;
    };
    if (jobs.waiting === 0 && jobs.retrying === 0 && jobs.running === null) {
      break;
    }
    if (Date.now() > deadline) {
      throw new Error(`background jobs not finished: ${JSON.stringify(jobs)}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
