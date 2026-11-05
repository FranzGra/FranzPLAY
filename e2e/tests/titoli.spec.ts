import type { Page } from "@playwright/test";
import { enter, expect, FRESH_ADMIN, LIBRARY, test } from "./server";

// Admin › Regole titoli: the rules that turn the names of the files into
// the titles people see, with their preview before saving, and the new
// titles on the Home, in the search and on the categories. Every test has
// a FranzPLAY of its own (server.ts): the rules change nothing elsewhere.

const card = (page: Page, title: string) =>
  page.getByRole("main").getByRole("heading", { level: 3, name: title, exact: true }).first();

// example is the line of the preview with what the rules make of a file.
const example = (page: Page, file: string) =>
  page.getByRole("listitem").filter({ hasText: file }).locator("b");

test("the rules show their result before saving, then rename the videos", async ({
  page,
  fresh,
}) => {
  await enter(page, fresh.base, FRESH_ADMIN);
  await page.goto("/admin/regole-titoli");
  await expect(page.getByText("Nessuna regola: il titolo è il nome del file")).toBeVisible();
  await expect(page.getByText("Nessuna modifica da salvare")).toBeVisible();
  const becomes = page.locator("p", { hasText: "Diventa" }).locator("b");
  await expect(becomes).toHaveText("Il_mio_video_[1080p]");
  await expect(example(page, "Città_di_notte.webm")).toHaveText("Città_di_notte");

  await page.getByRole("button", { name: "Trattini bassi in spazi" }).click();
  await page.getByRole("button", { name: "Togli i tag tra quadre, come [1080p]" }).click();
  await expect(page.getByLabel("Regola 1: testo da cercare")).toHaveValue("_");
  await expect(page.getByLabel("Regola 2: testo da cercare")).toHaveValue("\\[[^\\]]*\\]");

  // The preview follows the rules on the page, saved or not.
  await expect(becomes).toHaveText("Il mio video");
  await expect(example(page, "Città_di_notte.webm")).toHaveText("Città di notte");
  await expect(example(page, "Episodio_01_[720p].webm")).toHaveText("Episodio 01");
  await page.getByLabel("Prova un nome di file").fill("Gita_in_città_[4K]_2025.mkv");
  await expect(becomes).toHaveText("Gita in città 2025");

  // Nothing changed for people until "Salva regole".
  const titles = await page.request.get("/api/videos");
  const before = ((await titles.json()) as { videos: { title: string }[] }).videos;
  expect(before.map((v) => v.title)).toContain("Città_di_notte");

  await page.getByRole("button", { name: "Salva regole" }).click();
  await expect(
    page.getByText(`Salvato. Titoli aggiornati su ${LIBRARY.length} video.`),
  ).toBeVisible();
  await expect(page.getByText("Nessuna modifica da salvare")).toBeVisible();

  await page.goto("/");
  await expect(card(page, "Episodio 01")).toBeVisible();
  await expect(card(page, "Città di notte")).toBeVisible();
  await expect(card(page, "Natura è bella")).toBeVisible();
  await expect(card(page, "Città_di_notte")).toHaveCount(0);

  await page.goto("/cerca?q=episodio");
  await expect(card(page, "Episodio 01")).toBeVisible();
  await expect(card(page, "Episodio 02")).toBeVisible();
  await expect(card(page, "Episodio_01_[720p]")).toHaveCount(0);

  // Taking the rules away brings the names of the files back.
  await page.goto("/admin/regole-titoli");
  await page.getByRole("button", { name: "Togli la regola 2" }).click();
  await page.getByRole("button", { name: "Togli la regola 1" }).click();
  await page.getByRole("button", { name: "Salva regole" }).click();
  await expect(
    page.getByText(`Salvato. Titoli aggiornati su ${LIBRARY.length} video.`),
  ).toBeVisible();
  await page.goto("/");
  await expect(card(page, "Città_di_notte")).toBeVisible();
});

test("the rules can clean the names of the categories too", async ({ page, fresh }) => {
  await enter(page, fresh.base, FRESH_ADMIN);
  await page.goto("/admin/regole-titoli");
  await page.getByRole("button", { name: "Trattini bassi in spazi" }).click();
  await page.getByRole("switch", { name: "Applica anche alle categorie" }).check();
  await expect(example(page, "Stagione_1").last()).toHaveText("Stagione 1");
  await page.getByRole("button", { name: "Salva regole" }).click();
  await expect(page.getByText(/^Salvato./)).toBeVisible();

  await page.goto("/categorie");
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: /^Stagione 1/ })).toBeVisible();
  await expect(main.getByRole("link", { name: /^Stagione 2/ })).toBeVisible();
  await expect(main.getByText("Stagione_1")).toHaveCount(0);
});

test("a wrong regular expression is explained and never saved", async ({ page, fresh }) => {
  await enter(page, fresh.base, FRESH_ADMIN);
  await page.goto("/admin/regole-titoli");
  await page.getByRole("button", { name: "Aggiungi regola" }).click();
  await page.getByLabel("Regola 1: testo da cercare").fill("(senza fine");
  await page.getByRole("checkbox", { name: "Espressione regolare" }).check();
  await expect(page.getByRole("alert")).toContainText("Regola 1");

  await page.getByRole("button", { name: "Salva regole" }).click();
  await expect(page.getByRole("alert").first()).toContainText("Regola 1");
  await page.reload();
  await expect(page.getByText("Nessuna regola: il titolo è il nome del file")).toBeVisible();
});
