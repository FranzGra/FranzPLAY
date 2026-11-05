import { adminVideo, enter, expect, FRESH_ADMIN, mediaSeconds, test } from "./server";

// The cover and the clip on the card, chosen with the slider on the page of
// a video in the administration: FranzPLAY makes them again in its queue and
// the page shows the new ones by itself. Every test has a FranzPLAY of its
// own (server.ts).

const FILE = "Episodio_01_[720p].webm";
const TITLE = "Episodio_01_[720p]";

test("a moment chosen with the slider becomes the cover", async ({ page, fresh }) => {
  await enter(page, fresh.base, FRESH_ADMIN);
  // The moments to pick come from the previews: wait until they are made.
  await fresh.jobs();
  const video = await adminVideo(page, fresh.base, FILE);
  expect(video.coverChoice).toBe("");
  await page.goto(`/admin/video/${video.id}`);

  const cover = page.getByRole("region", { name: `Copertina di ${TITLE}` });
  const now = cover.getByRole("img", { name: "La copertina di adesso" });
  await expect(now).toHaveAttribute("src", /.+/);
  const before = await now.getAttribute("src");
  await expect(cover.getByText("Automatica: la sceglie FranzPLAY.")).toBeVisible();
  await expect(cover.getByRole("tab", { name: "Dal video" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await cover.getByRole("button", { name: "Scegli il secondo esatto" }).click();

  // The slider moves the video to its second, and names the button.
  const slider = page.getByRole("slider", { name: "Momento del video" });
  await slider.fill("7");
  await expect(page.getByText("0:07 di 0:12")).toBeVisible();
  const player = page.getByLabel("Il video: fermalo nel momento che vuoi come copertina");
  await expect
    .poll(() => player.evaluate((v: HTMLVideoElement) => Math.round(v.currentTime)))
    .toBe(7);
  await page.getByRole("button", { name: "Usa 0:07 come copertina" }).click();

  // Made in the queue, then in place without reloading.
  await expect(page.getByText("Copertina aggiornata.")).toBeVisible({ timeout: 60_000 });
  await expect(now).not.toHaveAttribute("src", before ?? "");
  await expect
    .poll(() => now.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(cover.getByText("Scelta: il momento 0:07 del video.")).toBeVisible();
  const after = await adminVideo(page, fresh.base, FILE);
  expect(after.coverChoice).toBe("moment");
  expect(after.coverSecond).toBe(7);

  // People see the new cover on the Home.
  await page.goto("/");
  const card = page.getByRole("link", { name: new RegExp(TITLE.replace(/[[\]]/g, "\\$&")) });
  await expect(card.first().locator("img").first()).toHaveAttribute("src", after.cover ?? "-");
});

test("the clip on the card starts where the slider says, and goes back", async ({
  page,
  fresh,
}) => {
  await enter(page, fresh.base, FRESH_ADMIN);
  await fresh.jobs();
  const video = await adminVideo(page, fresh.base, FILE);
  expect(video.clip).not.toBeNull();
  await page.goto(`/admin/video/${video.id}`);
  const clip = page.getByRole("region", { name: `Anteprima di ${TITLE}` });
  await expect(clip.getByText(/Pochi secondi presi da momenti diversi/)).toBeVisible();

  await clip.getByRole("button", { name: "Scegli il momento" }).click();
  await page.getByRole("slider", { name: "Inizio dell'anteprima" }).fill("4");
  await expect(page.getByText("0:04 di 0:12")).toBeVisible();
  const length = page.getByLabel("Durata (secondi)");
  const remake = page.getByRole("button", { name: "Rigenera anteprima da qui" });

  // A length out of bounds is refused before asking the server.
  await length.fill("40");
  await remake.click();
  await expect(page.getByRole("alert")).toHaveText("Scegli una durata tra 2 e 30 secondi.");

  await length.fill("5");
  await remake.click();
  await expect(
    page.getByText("In coda: l'anteprima riparte da 0:04 e dura 5 secondi."),
  ).toBeVisible();
  await expect(
    clip.getByText("Fatta dal video, a partire da 0:04, per 5 secondi: scelto da te."),
  ).toBeVisible();

  // The new clip is made in the queue: a new file, five seconds long.
  await fresh.jobs();
  await expect
    .poll(async () => (await adminVideo(page, fresh.base, FILE)).clip)
    .not.toBe(video.clip);
  const made = await adminVideo(page, fresh.base, FILE);
  expect(made.clipSecond).toBe(4);
  await page.reload();
  const shown = clip.getByLabel("L'anteprima di adesso");
  await expect(shown).toHaveAttribute("src", made.clip ?? "-");
  // ffprobe, not the browser: Playwright's Chromium has no H.264.
  expect(Math.round(await mediaSeconds(page, fresh.base, made.clip ?? ""))).toBe(5);

  // Back like the others: the choice is gone.
  await clip.getByRole("button", { name: "Torna come le altre" }).click();
  await expect(clip.getByText(/Pochi secondi presi da momenti diversi/)).toBeVisible();
  await expect.poll(async () => (await adminVideo(page, fresh.base, FILE)).clipSecond).toBeNull();
});
