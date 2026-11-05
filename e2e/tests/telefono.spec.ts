import type { Locator, Page } from "@playwright/test";
import { adminVideo, enter, expect, FRESH_ADMIN, pageFits, test } from "./server";

// On a phone 390 px wide nothing may make the main pages wider than the
// screen: they would slide sideways under the finger. The new pages
// included: categories by folder, the cards of Admin › Video, the cover
// and clip of a video, the title rules. Every test has a FranzPLAY of its
// own (server.ts).

test.use({ viewport: { width: 390, height: 844 } });

// fits opens path, waits for what shows the page is drawn, and checks
// nothing is wider than the window, the open pickers of a video included.
async function fits(page: Page, path: string, drawn: (page: Page) => Locator) {
  await test.step(path, async () => {
    await page.goto(path);
    await expect(drawn(page).first()).toBeVisible();
    const { width, scroll } = await pageFits(page);
    expect(scroll, `${path} is wider than the window`).toBeLessThanOrEqual(width);
  });
}

const h1 = (name: string | RegExp) => (page: Page) => page.getByRole("heading", { level: 1, name });
const card = (title: string) => (page: Page) =>
  page.getByRole("main").getByRole("heading", { level: 3, name: title });

test("the main pages fit a phone 390 px wide", async ({ page, fresh, isMobile }) => {
  test.skip(!isMobile, "the width of a phone, with touch");
  await enter(page, fresh.base, FRESH_ADMIN);
  await fresh.jobs();
  const video = await adminVideo(page, fresh.base, "Episodio_01_[720p].webm");

  await fits(page, "/", card("Città_di_notte"));
  await fits(page, "/categorie", (p) =>
    p.getByRole("main").getByRole("link", { name: /Stagione_2/ }),
  );
  await page
    .getByRole("main")
    .getByRole("link", { name: /Stagione_1/ })
    .click();
  await expect(card("Episodio_02_[720p]")(page).first()).toBeVisible();
  expect((await pageFits(page)).scroll).toBeLessThanOrEqual(390);
  await fits(page, "/cerca?q=episodio", card("Episodio_01_[720p]"));
  await fits(page, `/video/${video.id}`, (p) => p.locator("video"));
  await fits(page, "/playlist", h1(/Playlist/));
  await fits(page, "/profilo", (p) => p.getByRole("button", { name: "Esci" }));

  await fits(page, "/admin/video", (p) => p.getByRole("list", { name: "Video" }).getByRole("link"));
  await page.getByRole("group", { name: "Vista" }).getByRole("button", { name: "Card" }).click();
  await expect(page.getByRole("list", { name: "Video" }).getByRole("link")).toHaveCount(4);
  expect((await pageFits(page)).scroll).toBeLessThanOrEqual(390);

  await fits(page, `/admin/video/${video.id}`, h1("Episodio_01_[720p]"));
  // The pickers open wide: the cover's moment, the clip's start, the subtitles.
  await page.getByRole("button", { name: "Scegli il secondo esatto" }).click();
  await expect(page.getByRole("slider", { name: "Momento del video" })).toBeVisible();
  await page.getByRole("button", { name: "Scegli il momento" }).click();
  await expect(page.getByRole("slider", { name: "Inizio dell'anteprima" })).toBeVisible();
  await page.getByRole("button", { name: "Importa sottotitoli" }).click();
  await expect(page.getByRole("form", { name: /Importa sottotitoli per/ })).toBeVisible();
  expect((await pageFits(page)).scroll).toBeLessThanOrEqual(390);

  await fits(page, "/admin/categorie", (p) => p.getByRole("radio", { name: "Verticale (2:3)" }));
  await page.getByText("Verticale (2:3)").click();
  await expect(page.getByRole("radio", { name: "Verticale (2:3)" })).toBeChecked();
  await fits(page, "/categorie", (p) => p.getByRole("main").locator('ul[data-shape="portrait"]'));
  await fits(page, "/admin/regole-titoli", (p) => p.locator("p", { hasText: "Diventa" }));
  await page.getByRole("button", { name: "Togli i tag tra quadre, come [1080p]" }).click();
  await expect(page.getByLabel("Regola 1: testo da cercare")).toBeVisible();
  expect((await pageFits(page)).scroll).toBeLessThanOrEqual(390);
  await fits(page, "/admin/sottotitoli", h1("Sottotitoli"));
  await fits(page, "/admin/cartelle", (p) => p.getByRole("button", { name: "Controlla adesso" }));
});
