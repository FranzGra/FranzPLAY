import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADMIN, BASE, PASSWORD, PEOPLE, STATE_FILE } from "./tests/franzplay";
import { launch, makeLibrary, makeVideo, post, waitForJobs } from "./tests/server";

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
  // The library every test with a FranzPLAY of its own copies (server.ts).
  const template = join(root, "modello");
  makeLibrary(template);

  const server = await launch(join(root, "data"), library, Number(new URL(BASE).port));
  writeFileSync(STATE_FILE, JSON.stringify({ pid: server.process.pid, root, template }));

  const setup = await post(BASE, "/api/setup", { name: ADMIN, password: PASSWORD });
  const cookie = (setup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  for (const name of PEOPLE) {
    await post(
      BASE,
      "/api/users",
      { name, password: PASSWORD, role: "user", canUpload: true },
      cookie,
    );
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
  // Generous: a busy machine can take minutes to convert the test videos.
  await waitForJobs(BASE, cookie, 600_000);
}
