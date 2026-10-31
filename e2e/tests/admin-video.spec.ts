import { expect, test } from "@playwright/test";
import { ADMIN, BASE, logIn, videos } from "./franzplay";

// The page of one video in the administration, in a real browser.

test("the category field opens every category, and keeps a new one", async ({ page }) => {
  await logIn(page, ADMIN);
  const video = (await videos(page)).find((v) => v.title === "Gita al mare");
  expect(video).toBeDefined();
  const address = `/admin/video/${video?.id}`;
  await page.goto(address);
  const field = page.getByRole("combobox", { name: "Categoria" });
  const saved = page.getByRole("button", { name: "Salva modifiche" });

  // With words already in the field, a click still shows every category.
  await field.fill("Ciao");
  await page.keyboard.press("Escape");
  await field.click();
  const list = page.getByRole("listbox");
  await expect(list.getByRole("option", { name: "Vacanze", exact: true })).toBeVisible();
  await expect(list.getByRole("option", { name: "Corsi", exact: true })).toBeVisible();
  const box = await list.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);

  // A category that does not exist yet stays after saving and coming back.
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await field.fill("Categoria nuova");
  await expect(
    list.getByRole("option", { name: "Nuova categoria: «Categoria nuova»" }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await saved.click();
  await expect(page.getByText("Modifiche salvate.")).toBeVisible();
  await page.goto(address);
  await expect(field).toHaveValue("Categoria nuova");
  await field.click();
  await expect(list.getByRole("option", { name: "Categoria nuova" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Back as found, for the other checks.
  await page.getByRole("button", { name: "Usa questa" }).click();
  await saved.click();
  await expect(page.getByText("Modifiche salvate.")).toBeVisible();
});

test("the player of the administration shows the subtitles of the video", async ({ page }) => {
  await logIn(page, ADMIN);
  const video = (await videos(page)).find((v) => v.title === "Lezione 1");
  expect(video).toBeDefined();
  // No subtitles chosen in other runs: the button turns them on.
  await page.goto(`/admin/video/${video?.id}`);
  await page.getByRole("button", { name: "Guarda Lezione 1" }).click();
  const button = page.getByRole("button", { name: "Sottotitoli (c)" });
  await expect(button).toBeEnabled();
  await expect(page.locator("track")).toHaveAttribute(
    "src",
    new RegExp(`^(${BASE})?/api/videos/${video?.id}/subtitles/`),
  );
  await page.locator("video").first().hover({ force: true });
  await button.click();
  // The words are on screen from second 1 to 5: go back there until they show.
  const words = page.getByText("Ciao a tutti");
  await expect(async () => {
    await page
      .locator("video")
      .first()
      .evaluate((v: HTMLVideoElement) => {
        v.currentTime = 2;
      });
    await expect(words).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
});
