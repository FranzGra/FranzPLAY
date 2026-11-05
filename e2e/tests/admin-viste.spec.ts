import { adminVideo, enter, expect, FRESH_ADMIN, LIBRARY, send, test } from "./server";

// Admin › Video: the table and the cards, a card that opens the page of its
// video, the search and the pills. Every test has a FranzPLAY of its own
// (server.ts), with the four videos of server.ts.

test("the videos as a table or as cards; a card opens its video", async ({
  page,
  fresh,
  isMobile,
}) => {
  await enter(page, fresh.base, FRESH_ADMIN);
  await page.goto("/admin/video");
  const views = page.getByRole("group", { name: "Vista" });
  const table = views.getByRole("button", { name: "Tabella" });
  const cards = views.getByRole("button", { name: "Card" });
  await expect(table).toHaveAttribute("aria-pressed", "true");
  if (!isMobile) {
    const rows = page.getByRole("table", { name: "Video" }).locator("tbody tr");
    await expect(rows).toHaveCount(LIBRARY.length);
  }

  await cards.click();
  await expect(cards).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("table", { name: "Video" })).toHaveCount(0);
  const grid = page.getByRole("list", { name: "Video" });
  await expect(grid.getByRole("link")).toHaveCount(LIBRARY.length);

  // The browser remembers the view.
  await page.reload();
  await expect(cards).toHaveAttribute("aria-pressed", "true");

  const card = grid.getByRole("link", { name: /Città_di_notte/ });
  const video = await adminVideo(page, fresh.base, "Città_di_notte.webm");
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/admin/video/${video.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Città_di_notte" })).toBeVisible();

  await page.goBack();
  await expect(cards).toHaveAttribute("aria-pressed", "true");
  await table.click();
  await expect(table).toHaveAttribute("aria-pressed", "true");
  if (!isMobile) {
    await expect(page.getByRole("table", { name: "Video" })).toBeVisible();
  }
});

test("the search and the pills choose which videos show", async ({ page, fresh }) => {
  await enter(page, fresh.base, FRESH_ADMIN);
  await page.goto("/admin/video");
  await page.getByRole("group", { name: "Vista" }).getByRole("button", { name: "Card" }).click();
  const grid = page.getByRole("list", { name: "Video" });
  await expect(grid.getByRole("link")).toHaveCount(LIBRARY.length);

  // The search finds words with accents, and a folder's name.
  const search = page.getByRole("searchbox", { name: "Cerca tra i video" });
  await search.fill("natura");
  await search.press("Enter");
  await expect(page).toHaveURL(/q=natura/);
  await expect(grid.getByRole("link")).toHaveCount(1);
  await expect(grid.getByRole("link", { name: /Natura_è_bella/ })).toBeVisible();

  await search.fill("Stagione_1");
  await search.press("Enter");
  await expect(grid.getByRole("link")).toHaveCount(2);

  await search.fill("nessun video ha questo nome");
  await search.press("Enter");
  await expect(page.getByText("Nessun video con queste parole")).toBeVisible();
  await page.getByRole("button", { name: "Torna ai video idonei" }).click();
  await expect(search).toHaveValue("");
  await expect(grid.getByRole("link")).toHaveCount(LIBRARY.length);

  // A hidden video is still long enough and readable ("Idonei" keeps it),
  // and the only one in "Nascosti".
  const hidden = await adminVideo(page, fresh.base, "Episodio_02_[720p].webm");
  await send(page, fresh.base, "PUT", `/api/admin/videos/${hidden.id}/hidden`, { hidden: true });
  await page.reload();
  const pills = page.getByRole("group", { name: "Mostra" });
  await expect(grid.getByRole("link")).toHaveCount(LIBRARY.length);
  await pills.getByRole("button", { name: "Nascosti" }).click();
  await expect(page).toHaveURL(/show=hidden/);
  await expect(grid.getByRole("link")).toHaveCount(1);
  await expect(grid.getByRole("link", { name: /Episodio_02/ })).toBeVisible();
  await pills.getByRole("button", { name: "Tutti" }).click();
  await expect(grid.getByRole("link")).toHaveCount(LIBRARY.length);
});
