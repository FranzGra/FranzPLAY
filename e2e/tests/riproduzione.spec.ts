import type { Locator, Page } from "@playwright/test";
import { enter, expect, test } from "./server";

// Watching, as a person of the family does: a video plays, "Continua a
// guardare" takes it back where it was left, and a playlist keeps it for
// later. Every test has a FranzPLAY of its own (server.ts) and a person of
// its own.

// person creates someone for this test only and logs the page in.
async function person(page: Page, fresh: { base: string; user: (n: string) => Promise<void> }) {
  const name = "Lia";
  await fresh.user(name);
  await enter(page, fresh.base, name);
}

const time = (player: Locator) => player.evaluate((v: HTMLVideoElement) => v.currentTime);

// openCard opens the video of a card by its title.
async function openCard(where: Locator, title: string) {
  await where
    .getByRole("link", { name: new RegExp(title) })
    .first()
    .click();
}

test("a video plays, and Continua a guardare takes it back where it was", async ({
  page,
  fresh,
}) => {
  await person(page, fresh);
  await page.goto("/");
  // Nothing watched yet: no row to continue.
  await expect(page.getByRole("heading", { level: 1, name: "Esplora la libreria" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Continua a guardare" })).toHaveCount(0);

  await openCard(page.getByRole("main"), "Città_di_notte");
  await expect(page).toHaveURL(/\/video\/\d+$/);
  const player = page.locator("video");
  await expect(player).toHaveCount(1);
  // It starts by itself, and time moves on.
  await expect.poll(() => time(player)).toBeGreaterThan(0);
  const paused = await player.evaluate((v: HTMLVideoElement) => v.paused);
  expect(paused).toBe(false);
  // A jump tells the server where the video is: wait for that answer, so
  // the Home below does not ask before the place is saved.
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.url().endsWith("/progress") &&
      (r.request().postDataJSON() as { position: number }).position >= 6,
  );
  await player.evaluate((v: HTMLVideoElement) => {
    v.currentTime = 6;
  });
  await expect.poll(() => time(player)).toBeGreaterThanOrEqual(6);
  expect((await saved).ok()).toBe(true);

  // Leaving keeps the place.
  await page.goto("/");
  const row = page.getByRole("region", { name: "Continua a guardare" });
  await expect(row).toBeVisible();
  await expect(row.getByRole("heading", { level: 3, name: "Città_di_notte" })).toBeVisible();
  await openCard(row, "Città_di_notte");
  await expect(page.locator("video")).toHaveCount(1);
  // It starts again from there, not from the start.
  await expect.poll(() => time(page.locator("video"))).toBeGreaterThanOrEqual(5);
});

test("a video saved in a new playlist plays from the playlist", async ({
  page,
  fresh,
  isMobile,
}) => {
  await person(page, fresh);
  await page.goto("/");
  await openCard(page.getByRole("main"), "Natura_è_bella");
  await expect(page).toHaveURL(/\/video\/\d+$/);
  const address = new URL(page.url()).pathname;

  await page.getByRole("button", { name: "Salva", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Salva in una playlist" });
  await sheet.getByRole("button", { name: "Nuova playlist" }).click();
  await sheet.getByLabel("Nome della nuova playlist").fill("Da rivedere è");
  await sheet.getByRole("button", { name: "Crea" }).click();
  await expect(sheet.getByRole("checkbox", { name: "Da rivedere è" })).toBeChecked();
  // The phone's sheet has "Fatto"; the computer's panel closes with Escape.
  if (isMobile) await sheet.getByRole("button", { name: "Fatto" }).click();
  else await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: /Salva — in 1 playlist/ })).toBeVisible();

  await page.goto("/playlist");
  await page
    .getByRole("main")
    .getByRole("link", { name: /Da rivedere è/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Da rivedere è");
  const list = page.getByRole("main").getByRole("listitem");
  await expect(list).toHaveCount(1);
  await openCard(list, "Natura_è_bella");
  await expect(page).toHaveURL(new RegExp(`${address}`));
  await expect.poll(() => time(page.locator("video"))).toBeGreaterThan(0);
});
