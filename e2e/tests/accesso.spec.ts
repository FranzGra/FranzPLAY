import { type Browser, expect, type Page, test } from "@playwright/test";
import { ADMIN, BASE, logIn } from "./franzplay";

// The three ways to log in, in a real browser: the PIN on its keypad, the
// pattern drawn with the pointer, and the block after too many wrong tries.

// addPerson creates someone with a PIN or a pattern, as the administrator.
async function addPerson(page: Page, name: string, method: string, secret: string) {
  await logIn(page, ADMIN);
  const res = await page.request.post("/api/users", {
    data: { name, method, password: secret, role: "user", canUpload: false },
    headers: { Origin: BASE },
  });
  expect(res.status()).toBe(201);
}

// stranger is a new browser, logged out.
async function stranger(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

// entered checks the person is in: the Home shows the library.
async function entered(page: Page) {
  await expect(page.getByRole("heading", { name: "Esplora la libreria" })).toBeVisible();
}

async function typeName(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel("Nome").fill(name);
  await page.getByRole("button", { name: "Avanti" }).click();
}

test("PIN on the keypad", async ({ page, browser }, info) => {
  const name = `Nonna ${info.project.name}`;
  await addPerson(page, name, "pin", "482915");
  const guest = await stranger(browser);
  await typeName(guest, name);
  await expect(guest.getByText("0 cifre su 6")).toBeVisible();
  for (const digit of "482915") {
    await guest.getByRole("button", { name: digit, exact: true }).click();
  }
  await entered(guest);
});

test("pattern drawn with the pointer", async ({ page, browser }, info) => {
  const name = `Luca ${info.project.name}`;
  // An L: down the left column, then along the bottom row.
  await addPerson(page, name, "pattern", "14789");
  const guest = await stranger(browser);
  await typeName(guest, name);
  const board = guest.getByRole("group", { name: "Sequenza" });
  const box = await board.boundingBox();

  if (!box) throw new Error("no pattern grid");
  const at = (dot: number) => ({
    x: box.x + (((dot - 1) % 3) + 0.5) * (box.width / 3),
    y: box.y + (Math.floor((dot - 1) / 3) + 0.5) * (box.height / 3),
  });
  const path = [1, 4, 7, 8, 9].map(at);
  const [first, ...rest] = path;
  await guest.mouse.move(first?.x ?? 0, first?.y ?? 0);
  await guest.mouse.down();
  for (const p of rest) {
    await guest.mouse.move(p.x, p.y, { steps: 6 });
  }
  await guest.mouse.up();
  await entered(guest);
});

test("a PIN is blocked after 3 wrong tries, with the wait", async ({ page, browser }, info) => {
  const name = `Zia ${info.project.name}`;
  await addPerson(page, name, "pin", "135790");
  const guest = await stranger(browser);
  await typeName(guest, name);
  // The keypad takes the computer's keyboard too.
  await expect(guest.getByText("0 cifre su 6")).toBeVisible();
  const pin = guest.getByLabel(/PIN, 6 cifre/);
  for (const wrong of ["000000", "111111"]) {
    await expect(pin).toBeFocused();
    await guest.keyboard.type(wrong);
    await expect(guest.getByRole("alert")).toHaveText("Nome o PIN sbagliati.");
    await expect(guest.getByText("0 cifre su 6")).toBeVisible();
  }
  await expect(pin).toBeFocused();
  await guest.keyboard.type("222222");
  await expect(guest.getByRole("alert")).toContainText("riprova tra 5 minuti");

  // The administrator sees the block and lifts it.
  await page.goto("/admin/accessi");
  const blocked = page.getByRole("region", { name: "Bloccati adesso" });
  const row = blocked.getByRole("listitem").filter({ hasText: name.toLowerCase() });
  await row.getByRole("button", { name: "Sblocca" }).click();
  await expect(row).toHaveCount(0);
  await expect(pin).toBeFocused();
  await guest.keyboard.type("135790");
  await entered(guest);
});

test("setting a pattern in the profile takes two steps", async ({ page, browser }, info) => {
  const name = `Bea ${info.project.name}`;
  await addPerson(page, name, "password", "password-di-bea");
  const guest = await stranger(browser);
  await typeName(guest, name);
  await guest.getByLabel("Password").fill("password-di-bea");
  await guest.getByRole("button", { name: "Entra" }).click();
  await entered(guest);
  await guest.goto("/profilo");
  await guest.getByRole("button", { name: /Cambia accesso/ }).click();
  await guest.getByLabel("Password attuale").fill("password-di-bea");
  await guest.getByRole("button", { name: "Continua" }).click();
  await guest.getByRole("radio", { name: "Sequenza" }).click();

  const draw = async (label: string, dots: number[]) => {
    const grid = guest.getByRole("group", { name: label });
    await grid.scrollIntoViewIfNeeded();
    const box = await grid.boundingBox();
    if (!box) throw new Error(`no grid ${label}`);
    const at = (dot: number) => ({
      x: box.x + (((dot - 1) % 3) + 0.5) * (box.width / 3),
      y: box.y + (Math.floor((dot - 1) / 3) + 0.5) * (box.height / 3),
    });
    const [first, ...rest] = dots.map(at);
    await guest.mouse.move(first?.x ?? 0, first?.y ?? 0);
    await guest.mouse.down();
    for (const p of rest) await guest.mouse.move(p.x, p.y, { steps: 5 });
    await guest.mouse.up();
  };
  await draw("Nuova sequenza", [1, 2, 3]);
  await expect(guest.getByRole("alert")).toContainText("Unisci almeno 5 punti");
  await draw("Nuova sequenza", [7, 4, 1, 2, 3]);
  await guest.getByRole("button", { name: "Continua" }).click();
  await draw("Ripeti la sequenza", [7, 8, 9, 6, 3]);
  await expect(guest.getByRole("alert")).toContainText("non sono uguali");
  await expect(guest.getByText("Ridisegnala per confermare")).toBeVisible();
  await guest.waitForTimeout(700); // the wrong pattern, red, goes away
  await draw("Ripeti la sequenza", [7, 4, 1, 2, 3]);
  await expect(guest.locator("span", { hasText: "Sequenza confermata" })).toBeVisible();
  await guest.getByRole("button", { name: "Salva" }).click();
  await expect(guest.getByText(/Accesso cambiato/)).toBeVisible();
});
