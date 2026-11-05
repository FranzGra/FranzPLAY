import type { Page } from "@playwright/test";
import { adminVideo, enter, expect, FRESH_ADMIN, test } from "./server";

// Subtitles brought from a file: an .srt or a .vtt imported on the page of
// a video, a question before replacing the ones already there, and the
// words on the player. Every test has a FranzPLAY of its own (server.ts).

const FILE = "Natura_è_bella.webm";
const TITLE = "Natura_è_bella";

const SRT = "1\n00:00:01,000 --> 00:00:09,000\nPrima versione, con l'accento: è così\n";
const VTT = "WEBVTT\n\n00:00:01.000 --> 00:00:09.000\nSeconda versione dal file VTT\n";

// importFile opens the import on the page of the video and sends one file.
async function importFile(page: Page, name: string, text: string) {
  await page.getByRole("button", { name: "Importa sottotitoli" }).click();
  const form = page.getByRole("form", { name: `Importa sottotitoli per ${TITLE}` });
  await form.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(text),
  });
  await expect(form.getByText(name)).toBeVisible();
  await form.getByRole("button", { name: "Importa", exact: true }).click();
  return form;
}

test("an .srt, then a .vtt that replaces it after asking, show on the player", async ({
  page,
  fresh,
}) => {
  await enter(page, fresh.base, FRESH_ADMIN);
  // The player of the page opens once FranzPLAY has read the video.
  await fresh.jobs();
  const video = await adminVideo(page, fresh.base, FILE);
  await page.goto(`/admin/video/${video.id}`);

  await importFile(page, "natura.srt", SRT);
  await expect(page.getByText("Sottotitoli importati: italiano.")).toBeVisible();

  // The same language again: nothing changes before the administrator says so.
  const form = await importFile(page, "natura.vtt", VTT);
  const ask = form.getByRole("alertdialog", { name: "Sostituire i sottotitoli?" });
  await expect(ask).toContainText("Ci sono già sottotitoli in italiano per questo video.");
  await ask.getByRole("button", { name: "Non sostituire" }).click();
  await expect(ask).toHaveCount(0);
  await form.getByRole("button", { name: "Importa", exact: true }).click();
  await ask.getByRole("button", { name: "Sostituisci" }).click();
  // The form closes once the file is saved. The toast that follows lasts
  // 3.2 s and is the same as before: the player below is the real proof.
  await expect(form).toHaveCount(0);

  // The player of the page shows the words of the second file.
  await page.reload();
  await page.getByRole("button", { name: `Guarda ${TITLE}` }).click();
  const button = page.getByRole("button", { name: "Sottotitoli (c)" });
  await expect(button).toBeEnabled();
  await page.locator("video").first().hover({ force: true });
  await button.click();
  const words = page.getByText("Seconda versione dal file VTT");
  await expect(async () => {
    await page
      .locator("video")
      .first()
      .evaluate((v: HTMLVideoElement) => {
        v.currentTime = 3;
      });
    await expect(words).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByText("Prima versione")).toHaveCount(0);
});

test("a file that is not subtitles is refused at once", async ({ page, fresh }) => {
  await enter(page, fresh.base, FRESH_ADMIN);
  const video = await adminVideo(page, fresh.base, FILE);
  await page.goto(`/admin/video/${video.id}`);
  await page.getByRole("button", { name: "Importa sottotitoli" }).click();
  const form = page.getByRole("form", { name: `Importa sottotitoli per ${TITLE}` });
  await form.locator('input[type="file"]').setInputFiles({
    name: "appunti.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("non sono sottotitoli"),
  });
  await expect(form.getByRole("alert")).toBeVisible();
  await form.getByRole("button", { name: "Importa", exact: true }).click();
  await expect(form.getByRole("alert")).toHaveText("Scegli prima un file .srt o .vtt.");
  await form.getByRole("button", { name: "Lascia stare" }).click();
  await expect(form).toHaveCount(0);
});
