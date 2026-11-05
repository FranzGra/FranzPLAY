import { mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { enter, expect, FRESH_ADMIN, makeVideo, test } from "./server";

// The library as people see it: a file put in a folder shows up after a
// check of the folders, every folder with videos of its own is a category
// (a folder holding only folders is not), and the shape chosen for the
// category covers changes the Categories page. Every test has a FranzPLAY
// of its own (server.ts), with the library of server.ts.

const titleOnCard = (page: Page, title: string) =>
  page.getByRole("main").getByRole("heading", { level: 3, name: title, exact: true }).first();

test("a video put in a folder shows up after a check of the folders", async ({ page, fresh }) => {
  await enter(page, fresh.base, FRESH_ADMIN);
  await page.goto("/");
  await expect(titleOnCard(page, "Natura_è_bella")).toBeVisible();
  await expect(titleOnCard(page, "Arrivo_già_pronto")).toHaveCount(0);

  // Made elsewhere and moved in whole, as when a copy ends: never half a file.
  const work = mkdtempSync(join(tmpdir(), "franzplay-e2e-new-"));
  try {
    makeVideo(join(work, "nuovo.webm"), 6, 700, "320x180");
    const folder = join(fresh.library, "Nuovi_Arrivi");
    mkdirSync(folder, { recursive: true });
    renameSync(join(work, "nuovo.webm"), join(folder, "Arrivo_già_pronto.webm"));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  await page.goto("/admin/cartelle");
  await page.getByRole("button", { name: "Controlla adesso" }).click();
  await expect(page.getByRole("button", { name: "Controlla adesso" })).toBeEnabled();
  await page.goto("/");
  await expect(titleOnCard(page, "Arrivo_già_pronto")).toBeVisible();
  // Its folder is a new category.
  await page.goto("/categorie");
  await expect(page.getByRole("link", { name: /Nuovi_Arrivi/ })).toBeVisible();
});

test("every folder with videos is a category, the folder holding folders is not", async ({
  page,
  fresh,
}) => {
  await enter(page, fresh.base, FRESH_ADMIN);
  await page.goto("/categorie");
  const main = page.getByRole("main");
  for (const name of ["Stagione_1", "Stagione_2", "Documentari"]) {
    await expect(main.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await expect(main.getByRole("link")).toHaveCount(3);
  await expect(main.getByText("Serie_Prova")).toHaveCount(0);

  // A category holds the videos of its own folder only.
  await main.getByRole("link", { name: /^Stagione_1/ }).click();
  await expect(titleOnCard(page, "Episodio_01_[720p]")).toBeVisible();
  await expect(titleOnCard(page, "Episodio_02_[720p]")).toBeVisible();
  await expect(titleOnCard(page, "Città_di_notte")).toHaveCount(0);

  // The administrator sees the same categories, and where each comes from.
  await page.goto("/admin/categorie");
  const list = page.getByRole("list", { name: "Categorie" });
  await expect(list.getByRole("button")).toHaveCount(3);
  await expect(list.getByRole("button", { name: /Stagione_2/ })).toContainText(
    "Cartella: Serie_Prova/Stagione_2",
  );
  await expect(list.getByText("Serie_Prova", { exact: true })).toHaveCount(0);
});

// tileBox is the size of the first category on the Categories page.
async function tileBox(page: Page) {
  await page.goto("/categorie");
  const tile = page.getByRole("main").getByRole("link").first();
  await expect(tile).toBeVisible();
  const box = await tile.boundingBox();
  if (!box) throw new Error("no category on the page");
  return box;
}

test("the shape of the covers, chosen in Admin › Categorie, changes the grid", async ({
  page,
  fresh,
}) => {
  await enter(page, fresh.base, FRESH_ADMIN);
  const wide = await tileBox(page);
  expect(wide.width).toBeGreaterThan(wide.height);
  await expect(page.getByRole("main").locator("ul[data-shape]")).toHaveAttribute(
    "data-shape",
    "landscape",
  );

  await page.goto("/admin/categorie");
  const tall = page.getByRole("radio", { name: "Verticale (2:3)" });
  await expect(page.getByRole("radio", { name: "Orizzontale (16:9)" })).toBeChecked();
  await page.getByText("Verticale (2:3)").click();
  await expect(tall).toBeChecked();
  // The preview of the administrator changes at once.
  await expect(page.locator("[data-static][data-shape]").first()).toHaveAttribute(
    "data-shape",
    "portrait",
  );

  const portrait = await tileBox(page);
  await expect(page.getByRole("main").locator("ul[data-shape]")).toHaveAttribute(
    "data-shape",
    "portrait",
  );
  expect(portrait.height).toBeGreaterThan(portrait.width);
  // Tall covers are narrower: more of them in a line, never fewer.
  expect(portrait.width).toBeLessThan(wide.width);

  // Saved for everybody: a new visit still has it.
  await page.reload();
  await expect(page.getByRole("main").locator("ul[data-shape]")).toHaveAttribute(
    "data-shape",
    "portrait",
  );

  await page.goto("/admin/categorie");
  await page.getByText("Quadrata (1:1)").click();
  await expect(page.getByRole("radio", { name: "Quadrata (1:1)" })).toBeChecked();
  const square = await tileBox(page);
  expect(Math.abs(square.width - square.height)).toBeLessThanOrEqual(2);
});
