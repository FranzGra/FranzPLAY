import { PASSWORD } from "./franzplay";
import { enter, expect, FRESH_ADMIN, test } from "./server";

// The first minutes of a new FranzPLAY, and who may do what: the first
// visitor creates the administrator, people go out and come back in, and
// a person who is not the administrator never sees the administration.
// Every test has a FranzPLAY of its own (server.ts).

const home = (page: import("@playwright/test").Page) =>
  page.getByRole("heading", { level: 1, name: "Esplora la libreria" });

test.describe("a new FranzPLAY", () => {
  test.use({ withAdmin: false });

  test("the first visitor creates the administrator in three steps", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Benvenuto in FranzPLAY" })).toBeVisible();
    const next = page.getByRole("button", { name: "Avanti" });

    await page.getByLabel("Nome").fill("Marta");
    await next.click();
    await expect(page.getByText("La userai per entrare come")).toContainText("Marta");

    // Two different passwords stop the wizard on this step.
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Ripeti la password").fill(`${PASSWORD}-altra`);
    await next.click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("Ripeti la password")).toBeVisible();
    await page.getByLabel("Ripeti la password").fill(PASSWORD);
    await next.click();

    await expect(page.getByRole("region", { name: "Il tuo sito" })).toBeVisible();
    await page.getByRole("button", { name: "Crea e entra" }).click();
    await expect(home(page)).toBeVisible();

    // The new administrator has the administration, and the wizard is gone.
    await page.goto("/admin");
    await expect(
      page.getByRole("navigation", { name: "Sezioni dell'amministrazione" }),
    ).toBeVisible();
    const again = await page.request.get("/api/setup");
    expect(((await again.json()) as { needed?: boolean }).needed ?? false).toBe(false);
  });
});

test("the administrator goes out and comes back in with the password", async ({ page }) => {
  await page.goto("/");
  // Not logged in: the page asks who is there.
  await expect(page.getByLabel("Nome")).toBeVisible();

  // A wrong password says so and lets in nobody.
  await page.getByLabel("Nome").fill(FRESH_ADMIN);
  await page.getByLabel("Password").fill("password-sbagliata");
  await page.getByRole("button", { name: "Entra", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Nome o password sbagliati.");

  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Entra", exact: true }).click();
  await expect(home(page)).toBeVisible();

  await page.goto("/profilo");
  await page.getByRole("button", { name: "Esci" }).click();
  await expect(page.getByLabel("Nome")).toBeVisible();
  // Out means out: the server no longer knows this browser.
  expect((await page.request.get("/api/me")).status()).toBe(401);
  await page.goto("/admin");
  await expect(page.getByLabel("Nome")).toBeVisible();
});

test("a person sees the library but not the administration", async ({
  page,
  fresh,
  isMobile,
}, info) => {
  const name = `Teo ${info.project.name}`;
  await fresh.user(name);
  await enter(page, fresh.base, name);
  await page.goto("/");
  await expect(home(page)).toBeVisible();
  if (!isMobile) {
    const menu = page.getByRole("navigation", { name: "Menu principale" });
    await expect(menu.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Amministrazione" })).toHaveCount(0);
  }
  await page.goto("/admin/video");
  await expect(
    page.getByRole("heading", { level: 1, name: "Solo per l'amministratore" }),
  ).toBeVisible();
  // The server says no too, whatever the page shows.
  expect((await page.request.get("/api/admin/videos")).status()).toBe(403);
});

test("the administrator sees the administration in the menu", async ({ page, fresh, isMobile }) => {
  test.skip(isMobile, "the phone has no side menu");
  await enter(page, fresh.base, FRESH_ADMIN);
  await page.goto("/");
  const menu = page.getByRole("navigation", { name: "Menu principale" });
  await menu.getByRole("link", { name: "Amministrazione" }).click();
  await expect(page).toHaveURL(/\/admin\/riepilogo$/);
  await expect(
    page.getByRole("navigation", { name: "Sezioni dell'amministrazione" }),
  ).toBeVisible();
});
