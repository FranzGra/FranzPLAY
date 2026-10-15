import { expect, test } from "@playwright/test";
import { ADMIN, BASE, logIn, PEOPLE, videos, watchErrors } from "./franzplay";

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
  // Everyone has the "Guarda più tardi" list: its page is a playlist page.
  const lists = await page.request.get("/api/playlists");
  expect(lists.ok()).toBe(true);
  const playlists = (await lists.json()) as { id: number }[];
  for (const path of [
    ...paths,
    `/video/${all[0].id}`,
    "/canale/1",
    `/playlist/${playlists[0].id}`,
  ]) {
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
      // Every picture stays inside its box: a picture that pushes its card
      // wider makes the whole page shrink on a phone.
      const spilling = await page.evaluate(() =>
        Array.from(document.querySelectorAll("main img"))
          .filter((img) => {
            const box = img.parentElement?.getBoundingClientRect();
            return box && img.getBoundingClientRect().width > box.width + 1;
          })
          .map((img) => img.outerHTML.slice(0, 80)),
      );
      expect(spilling, `${path} has pictures wider than their box`).toEqual([]);
      expect(errors, `${path} had errors`).toEqual([]);
      // On a computer a page narrower than the room it has (a column with a
      // fixed largest width) sits in the middle, not stuck to the left with
      // an empty band on the right. Text paragraphs may stay on the left.
      if (!phone) {
        const offCenter = await page.evaluate(() => {
          const room = document.querySelector("main > div");
          if (!room) return ["no page box"];
          const box = room.getBoundingClientRect();
          return Array.from(room.children)
            .filter(
              (part) => part.tagName !== "P" && getComputedStyle(part).maxWidth.endsWith("px"),
            )
            .filter((part) => {
              const own = part.getBoundingClientRect();
              return Math.abs(own.left - box.left - (box.right - own.right)) > 2;
            })
            .map((part) => part.outerHTML.slice(0, 80));
        });
        expect(offCenter, `${path} has a column that is not in the middle`).toEqual([]);
      }
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

test("on the phone the videos come one per line, as wide as the screen", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "only on phones");
  await logIn(page, PEOPLE[0]);
  for (const path of ["/", "/categorie/Vacanze"]) {
    await test.step(path, async () => {
      await page.goto(path);
      const card = page.locator('main a[data-layout="grid"]').first();
      await expect(card).toBeVisible();
      await page.waitForTimeout(400); // the page slides in
      const { width, cards } = await page.evaluate(() => ({
        width: window.innerWidth,
        cards: Array.from(document.querySelectorAll('main a[data-layout="grid"]'))
          .map((card) => card.getBoundingClientRect())
          .filter((box) => box.left >= 0 && box.right <= window.innerWidth)
          .map((box) => ({ left: box.left, top: box.top, width: box.width })),
      }));
      // The screen's edges leave 16px each side; the card takes the rest.
      expect(cards[0]?.width).toBeGreaterThanOrEqual(width - 40);
      expect(cards[0]?.width).toBeLessThanOrEqual(width);
      // Never two cards side by side on the screen.
      const rows = new Set(cards.map((box) => Math.round(box.top)));
      expect(rows.size).toBe(cards.length);
    });
  }
});

test("on the phone Salva opens a window over the whole screen", async ({ page, isMobile }) => {
  test.skip(!isMobile, "on a computer Salva stays a small panel");
  await logIn(page, PEOPLE[0]);
  const all = await videos(page);
  await page.goto(`/video/${all[0].id}`);
  await page.getByRole("button", { name: "Salva", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Salva in una playlist" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("checkbox", { name: "Guarda più tardi" })).toBeAttached();
  await page.waitForTimeout(500); // it rises from the bottom
  const box = await sheet.boundingBox();
  const size = page.viewportSize();
  expect(box).toEqual({ x: 0, y: 0, width: size?.width, height: size?.height });
  // Nothing lies on top of it, the bottom bar included.
  const onTop = await page.evaluate(() => {
    const at = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 10);
    return at?.closest('[role="dialog"]') !== null;
  });
  expect(onTop).toBe(true);
  // The close button sits at the right end of the title line.
  const close = await sheet.getByRole("button", { name: "Chiudi" }).boundingBox();
  expect((close?.x ?? 0) + (close?.width ?? 0)).toBeGreaterThan((size?.width ?? 0) - 24);
  await sheet.getByRole("button", { name: "Fatto" }).click();
  await expect(sheet).toBeHidden();
});

test("on the computer Salva opens over everything, the videos on the right included", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "on a phone Salva covers the whole screen");
  await logIn(page, PEOPLE[0]);
  const all = await videos(page);
  await page.goto(`/video/${all[0].id}`);
  await page.getByRole("button", { name: "Salva", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Salva in una playlist" });
  await expect(panel.getByRole("checkbox", { name: "Guarda più tardi" })).toBeAttached();
  await page.waitForTimeout(500); // it grows out of the button
  // Every corner of the panel is the panel itself: nothing lies on top of it.
  // (A bit inside the corners, which are round.)
  const covered = await panel.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const points = [
      [box.left + 20, box.top + 20],
      [box.right - 20, box.top + 20],
      [box.left + 20, box.bottom - 20],
      [box.right - 20, box.bottom - 20],
    ];
    return points.filter(([x, y]) => !element.contains(document.elementFromPoint(x, y))).length;
  });
  expect(covered).toBe(0);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("who sees a list opens over the page, without moving its title", async ({
  page,
  isMobile,
}) => {
  await logIn(page, PEOPLE[0]);
  const all = await videos(page);
  const made = await page.request.post("/api/playlists", {
    data: { name: "Chi la vede" },
    headers: { Origin: BASE },
  });
  const list = (await made.json()) as { id: number };
  // The last video, and the list goes away at the end: the other checks
  // expect the first video in no list ("Salva", not "Salvato").
  await page.request.put(`/api/playlists/${list.id}/videos/${all[all.length - 1].id}`, {
    headers: { Origin: BASE },
  });
  await page.goto(`/playlist/${list.id}`);
  const title = page.getByRole("heading", { level: 1 });
  const row = page.getByRole("main").getByRole("listitem").last();
  await expect(row).toBeVisible();
  await page.waitForTimeout(600); // the page slides in
  const before = { title: await title.boundingBox(), row: await row.boundingBox() };
  await page.getByRole("button", { name: "Chi la vede" }).click();
  const panel = page.getByRole("dialog", { name: "Chi la vede" });
  await expect(panel.getByRole("radio", { name: "Solo io" })).toBeChecked();
  await page.waitForTimeout(500); // it grows out of the button, or rises
  // Nothing on the page moved or stretched to make room for it.
  expect(await title.boundingBox()).toEqual(before.title);
  expect(await row.boundingBox()).toEqual(before.row);
  if (isMobile) {
    const size = page.viewportSize();
    expect(await panel.boundingBox()).toEqual({
      x: 0,
      y: 0,
      width: size?.width,
      height: size?.height,
    });
  }
  // Every corner of the window is the window itself: nothing lies on top
  // of it, the bottom bar on a phone included. (A bit inside the corners,
  // which are round.)
  const covered = await panel.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const points = [
      [box.left + 20, box.top + 20],
      [box.right - 20, box.top + 20],
      [box.left + 20, box.bottom - 20],
      [box.right - 20, box.bottom - 20],
    ];
    return points.filter(([x, y]) => !element.contains(document.elementFromPoint(x, y))).length;
  });
  expect(covered).toBe(0);
  await expect(panel.getByRole("button", { name: "Salva" })).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await page.request.delete(`/api/playlists/${list.id}`, { headers: { Origin: BASE } });
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
