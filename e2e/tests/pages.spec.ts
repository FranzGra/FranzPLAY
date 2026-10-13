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
  "/cerca?q=giulia", // finds a person
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

async function checkPages(page: import("@playwright/test").Page, paths: string[], phone: boolean) {
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
      // On a phone a field with letters smaller than 16px makes Safari
      // zoom the whole page in when touched.
      if (phone) {
        const small = await page.evaluate(() =>
          Array.from(document.querySelectorAll("input, textarea, select"))
            .filter(
              (field) =>
                !/^(checkbox|radio|range|color|file|hidden)$/.test(
                  field.getAttribute("type") ?? "",
                ),
            )
            .filter((field) => Number.parseFloat(getComputedStyle(field).fontSize) < 16)
            .map((field) => field.outerHTML.slice(0, 80)),
        );
        expect(small, `${path} has fields Safari zooms into`).toEqual([]);
      }
    });
  }
}

test("a person's pages open and fit the screen", async ({ page, isMobile }) => {
  await logIn(page, PEOPLE[0]);
  await checkPages(page, userPages, isMobile);
});

test("the administration pages open and fit the screen", async ({ page, isMobile }) => {
  await logIn(page, ADMIN);
  await checkPages(page, adminPages, isMobile);
});

test("on the phone the bottom bar is on screen", async ({ page, isMobile }) => {
  test.skip(!isMobile, "only phones have the bottom bar");
  await logIn(page, PEOPLE[0]);
  await page.goto("/");
  const bar = page.getByRole("navigation").filter({ hasText: "Profilo" }).last();
  await expect(bar).toBeInViewport();
});

test("on the computer the side menu stays in place while the page scrolls", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "phones have no side menu");
  await logIn(page, PEOPLE[0]);
  // A short window, so the Home is taller than it and scrolls.
  await page.setViewportSize({ width: 1440, height: 420 });
  await page.goto("/");
  const menu = page.getByRole("navigation", { name: "Menu principale" });
  const before = await menu.boundingBox();
  await page.mouse.move(900, 300);
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  // Half a pixel of give: the top bar is not a whole number of pixels tall.
  expect((await menu.boundingBox())?.y).toBeCloseTo(before?.y ?? -1, 0);
  await expect(menu.getByRole("link", { name: "Home" })).toBeInViewport();
});

test("the administration tabs stay on one line and show the open page", async ({ page }) => {
  await logIn(page, ADMIN);
  await page.goto("/admin/sito");
  const tabs = page.getByRole("navigation", { name: "Sezioni dell'amministrazione" });
  // One line: on a phone the row slides sideways instead of piling up.
  // Both are measured at once, as the page may still be sliding in.
  const tops = await tabs.evaluate((row) =>
    [...row.querySelectorAll("a")].map((a) => a.getBoundingClientRect().top),
  );
  expect(new Set(tops).size).toBe(1);
  // The last tab is the open page: it was brought into view.
  await expect(tabs.getByRole("link", { name: "Sito" })).toBeInViewport();
});
