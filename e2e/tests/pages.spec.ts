import { expect, test } from "@playwright/test";
import { ADMIN, logIn, PEOPLE, videos, watchErrors } from "./franzplay";

// Every page opens without errors and fits the screen: nothing may make
// the page wider than the window, or on the phone it slides sideways
// under the finger and the bottom bar ends up off screen.
const userPages = [
  "/",
  "/categorie",
  "/categorie/Vacanze",
  "/cerca?q=lezione",
  "/playlist",
  "/cronologia",
  "/mi-piace",
  "/condivisi",
  "/profilo",
  "/carica",
];

const adminPages = [
  "/admin/riepilogo",
  "/admin/persone",
  "/admin/inviti",
  "/admin/accessi",
  "/admin/video",
  "/admin/categorie",
  "/admin/sottotitoli",
  "/admin/commenti",
  "/admin/cartelle",
  "/admin/internet",
  "/admin/lavori",
  "/admin/sito",
];

async function checkPages(page: import("@playwright/test").Page, paths: string[]) {
  const errors = watchErrors(page);
  const all = await videos(page);
  for (const path of [...paths, `/video/${all[0].id}`, "/canale/1"]) {
    await test.step(path, async () => {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      // Let the page ask the server for its data and draw it.
      await page.waitForTimeout(400);
      const { width, scroll } = await page.evaluate(() => ({
        width: window.innerWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(scroll, `${path} is wider than the window`).toBeLessThanOrEqual(width);
      expect(errors, `${path} had errors`).toEqual([]);
    });
  }
}

test("a person's pages open and fit the screen", async ({ page }) => {
  await logIn(page, PEOPLE[0]);
  await checkPages(page, userPages);
});

test("the administration pages open and fit the screen", async ({ page }) => {
  await logIn(page, ADMIN);
  await checkPages(page, adminPages);
});

test("on the phone the bottom bar is on screen", async ({ page, isMobile }) => {
  test.skip(!isMobile, "only phones have the bottom bar");
  await logIn(page, PEOPLE[0]);
  await page.goto("/");
  const bar = page.getByRole("navigation").filter({ hasText: "Profilo" }).last();
  await expect(bar).toBeInViewport();
});
