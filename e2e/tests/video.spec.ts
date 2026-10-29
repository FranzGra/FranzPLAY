import { expect, type Locator, type Page, test } from "@playwright/test";
import { BASE, logIn, PEOPLE, videos, watchErrors } from "./franzplay";

// The heart of FranzPLAY: a video starts quickly and jumps quickly. The
// limits are generous, for slow CI computers; on a normal day both take
// a small fraction of them.
const START_LIMIT_MS = 5_000;
const JUMP_LIMIT_MS = 3_000;

test("a video starts and jumps quickly", async ({ page }) => {
  const errors = watchErrors(page);
  await logIn(page, PEOPLE[0]);
  const video = (await videos(page)).find((v) => v.title === "Gita al mare");
  expect(video, "the test video is in the catalog").toBeDefined();

  const opened = Date.now();
  await page.goto(`/video/${video?.id}`);
  const player = page.locator("video");
  await expect(player).toHaveCount(1);
  // The video starts by itself: its time moves on.
  await expect
    .poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime), {
      timeout: START_LIMIT_MS,
    })
    .toBeGreaterThan(0);
  const started = Date.now() - opened;

  // Jump to the middle, where nothing was downloaded yet.
  const jumped = await player.evaluate(
    (v: HTMLVideoElement) =>
      new Promise<number>((done) => {
        const from = performance.now();
        v.addEventListener("seeked", () => done(performance.now() - from), {
          once: true,
        });
        v.currentTime = 25;
      }),
  );
  expect(jumped).toBeLessThan(JUMP_LIMIT_MS);
  test
    .info()
    .annotations.push(
      { type: "start", description: `${started} ms` },
      { type: "jump", description: `${Math.round(jumped)} ms` },
    );
  expect(errors).toEqual([]);

  // Leaving the page keeps the place: "Continua a guardare" starts there.
  await page.goto("/");
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/videos/${video?.id}/progress`);
      return ((await res.json()) as { position: number }).position;
    })
    .toBeGreaterThanOrEqual(20);
});

test("the server answers jumps in the file with only the part asked", async ({ page }) => {
  await logIn(page, PEOPLE[0]);
  const video = (await videos(page))[0];
  const res = await page.request.get(`/api/videos/${video.id}/stream`, {
    headers: { Range: "bytes=1000-1999" },
  });
  expect(res.status()).toBe(206);
  expect((await res.body()).length).toBe(1000);
});

test("the timeline shows a sharp frame of the time pointed at", async ({ page, isMobile }) => {
  test.skip(isMobile, "phones have no pointer to move over the timeline");
  const errors = watchErrors(page);
  await logIn(page, PEOPLE[0]);
  const video = (await videos(page)).find((v) => v.title === "Gita al mare");
  await page.goto(`/video/${video?.id}`);
  const timeline = page.getByRole("slider", { name: "Posizione nel video" });
  const box = await timeline.boundingBox();
  expect(box, "the timeline is on the page").not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const frame = page.getByTestId("preview").locator("div").first();
  await expect(frame).toBeVisible();
  // Shown 240 points wide, from an image made with frames twice as sharp.
  const shown = await frame.evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.round(shown)).toBe(244); // with its 2-point border
  const image = await frame.evaluate(async (el) => {
    const src = getComputedStyle(el).backgroundImage.slice(5, -2);
    const img = new Image();
    img.src = src;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  });
  expect(image.width % 480).toBe(0);
  expect(image.height % 270).toBe(0);
  expect(errors).toEqual([]);
});

test("on a phone the card in the middle of the screen plays its clip", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "with a mouse a clip plays when the mouse rests on a card");
  await logIn(page, PEOPLE[0]);
  await page.goto("/");
  // Scrolling starts nothing; once the page is still, one clip plays.
  await page.mouse.wheel(0, 500);
  // (Clips are MP4 with H.264, which the test browser cannot play: the
  // clip being there is what this checks.)
  await expect(page.getByTestId("clip")).toHaveCount(1);
});

test("on a phone a tap shows the controls and a double tap jumps", async ({ page, isMobile }) => {
  test.skip(!isMobile, "taps are for touch screens");
  await logIn(page, PEOPLE[0]);
  const video = (await videos(page)).find((v) => v.title === "Gita al mare");
  await page.goto(`/video/${video?.id}`);
  const player = page.locator("[data-controls] video");
  const root = page.locator("[data-controls]");
  // Playing, untouched for a while: the controls go away.
  await expect
    .poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0);
  // An earlier test watched this video, so it starts where that one
  // stopped, near the end: back to the start, so a jump has room.
  await player.evaluate((v: HTMLVideoElement) => {
    v.currentTime = 0;
  });
  await expect(root).toHaveAttribute("data-controls", "hidden", { timeout: 10_000 });

  const box = await root.boundingBox();
  if (!box) throw new Error("the player has no size");
  const y = box.y + box.height / 2;
  // A tap brings them back, and they stay after the finger lifts.
  await page.touchscreen.tap(box.x + box.width / 2, y);
  await page.waitForTimeout(500);
  await expect(root).toHaveAttribute("data-controls", "visible");

  // A double tap on the right, where the controls' shade is, jumps
  // forward and does not go full screen.
  const before = await player.evaluate((v: HTMLVideoElement) => v.currentTime);
  await page.touchscreen.tap(box.x + box.width * 0.85, box.y + box.height * 0.6);
  await page.touchscreen.tap(box.x + box.width * 0.85, box.y + box.height * 0.6);
  await expect
    .poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(before + 10);
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();

  // With the controls away, a double tap shows only the jump icon: the
  // controls never come up, not even between the two taps.
  await expect(root).toHaveAttribute("data-controls", "hidden", { timeout: 10_000 });
  await root.evaluate((el) => {
    const seen = new MutationObserver(() => {
      if (el.getAttribute("data-controls") === "visible") el.setAttribute("data-seen", "visible");
    });
    seen.observe(el, { attributes: true, attributeFilter: ["data-controls"] });
  });
  await page.touchscreen.tap(box.x + box.width * 0.15, y);
  await page.touchscreen.tap(box.x + box.width * 0.15, y);
  await page.waitForTimeout(800);
  await expect(root).toHaveAttribute("data-controls", "hidden");
  await expect(root).not.toHaveAttribute("data-seen", "visible");
});

// countGlides counts the browser's smooth page changes (view transitions) from
// now on, and waitGlides waits until all of them have ended.
async function countGlides(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { glides: Promise<void>[] };
    w.glides = [];
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (update) => {
      const glide = start(update);
      w.glides.push(glide.finished);
      return glide;
    };
  });
}

async function waitGlides(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const w = window as unknown as { glides: Promise<void>[] };
    await Promise.all(w.glides);
    return w.glides.length;
  });
}

async function openTheaterTest(page: Page) {
  await logIn(page, PEOPLE[0]);
  const video = (await videos(page)).find((v) => v.title === "Gita al mare");
  await page.goto(`/video/${video?.id}`);
  await expect(page.locator("video")).toHaveCount(1);
}

// steadyBox measures an element once the page has stopped moving it: the
// page around the player may still settle by a pixel just after loading.
async function steadyBox(element: Locator) {
  let box = await element.boundingBox();
  for (let i = 0; i < 20; i++) {
    await element.page().waitForTimeout(100);
    const next = await element.boundingBox();
    if (JSON.stringify(next) === JSON.stringify(box)) {
      return next;
    }
    box = next;
  }
  return box;
}

test("theater mode glides in and out, and nothing else jumps", async ({ page, isMobile }) => {
  test.skip(isMobile, "theater mode is for wide screens");
  const errors = watchErrors(page);
  await openTheaterTest(page);
  const player = page.locator("[data-controls]");
  const menu = page.getByRole("navigation", { name: "Menu principale" });
  const normal = await steadyBox(player);
  await countGlides(page);

  await page.keyboard.press("t");
  expect(await waitGlides(page)).toBe(1);
  await expect(menu).toBeHidden();
  const theater = await player.boundingBox();
  expect(theater?.width).toBeGreaterThan((normal?.width ?? 0) + 100);

  await page.keyboard.press("t");
  expect(await waitGlides(page)).toBe(2);
  // On the video page the side menu stays folded away until ☰ opens it.
  await expect(menu).toBeHidden();
  // Back to the same place and size.
  const back = await steadyBox(player);
  for (const side of ["x", "y", "width", "height"] as const) {
    expect(back?.[side]).toBeCloseTo(normal?.[side] ?? 0, 0);
  }
  // The page stays where it was: only the player changes size.
  expect(await page.evaluate(() => scrollY)).toBe(0);
  expect(errors).toEqual([]);
});

test("theater mode switches at once for whoever asked for less motion", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "theater mode is for wide screens");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTheaterTest(page);
  await countGlides(page);
  await page.keyboard.press("t");
  await expect(page.getByRole("navigation", { name: "Menu principale" })).toBeHidden();
  expect(await waitGlides(page)).toBe(0);
});

test("the big play button grows in place under the mouse", async ({ page, isMobile }) => {
  test.skip(isMobile, "a finger does not hover");
  // The browser refuses to start by itself: the big button stays.
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () =>
      Promise.reject(new DOMException("needs a click first", "NotAllowedError"));
  });
  await logIn(page, PEOPLE[0]);
  const video = (await videos(page)).find((v) => v.title === "Gita al mare");
  await page.goto(`/video/${video?.id}`);
  const big = page.getByRole("button", { name: "Guarda" });
  const before = await steadyBox(big);
  await big.hover();
  const after = await steadyBox(big);
  const middle = (box: typeof before) => [
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  ];
  expect(after?.width).toBeGreaterThan((before?.width ?? 0) + 2);
  const [x0, y0] = middle(before);
  const [x1, y1] = middle(after);
  expect(x1).toBeCloseTo(x0, 0);
  expect(y1).toBeCloseTo(y0, 0);
});

test("a card's cover grows into the player, and back into its card", async ({ page }) => {
  const errors = watchErrors(page);
  await logIn(page, PEOPLE[0]);
  await page.goto("/");
  const cover = page.locator("main [data-card-video]").first();
  await expect(cover).toBeVisible();
  const id = await cover.getAttribute("data-card-video");
  // Notes, from inside the page, whether the browser really ran a view
  // transition (the ::view-transition pseudo-element tree exists while it
  // runs) and which elements carried the shared name.
  await page.evaluate(() => {
    const seen = { started: 0, pseudo: false };
    (window as unknown as { seen: typeof seen }).seen = seen;
    if (!document.startViewTransition) return;
    const real = document.startViewTransition.bind(document);
    document.startViewTransition = ((update: () => Promise<void>) => {
      seen.started++;
      const t = real(update);
      t.ready
        .then(() => {
          seen.pseudo = document
            .getAnimations()
            .some((a) =>
              (a.effect as KeyframeEffect).pseudoElement?.startsWith("::view-transition"),
            );
        })
        .catch(() => {});
      return t;
    }) as typeof document.startViewTransition;
  });
  await cover.click();
  await expect(page).toHaveURL(`/video/${id}`);
  const player = page.locator(`[data-video-frame="${id}"]`);
  await expect(player.locator("video")).toHaveCount(1);
  // The player is in its place, at the top of the page, as wide as it gets.
  const box = await player.boundingBox();
  expect(box?.y).toBeLessThan(140);
  expect(box?.width).toBeGreaterThan(300);
  const seen = await page.evaluate(
    () => (window as unknown as { seen: { started: number; pseudo: boolean } }).seen,
  );
  expect(seen.started).toBe(1);
  expect(seen.pseudo).toBe(true);
  // When it is over, no element keeps the shared name.
  await expect(page.locator("[style*=view-transition-name]")).toHaveCount(0);

  await page.goBack();
  await expect(page.locator(`main [data-card-video="${id}"]`).first()).toBeVisible();
  await expect(page.locator("[style*=view-transition-name]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("without view transitions, or with less motion, a card is a plain link", async ({
  browser,
}) => {
  for (const [init, reducedMotion] of [
    ["delete Document.prototype.startViewTransition;", "no-preference"],
    ["", "reduce"],
  ] as const) {
    const context = await browser.newContext({ baseURL: BASE, reducedMotion });
    if (init) await context.addInitScript(init);
    await context.addInitScript(`window.calls = 0;
      if (document.startViewTransition) {
        const real = document.startViewTransition.bind(document);
        document.startViewTransition = (u) => { window.calls++; return real(u); };
      }`);
    const page = await context.newPage();
    const errors = watchErrors(page);
    await logIn(page, PEOPLE[0]);
    await page.goto("/");
    const cover = page.locator("main [data-card-video]").first();
    const id = await cover.getAttribute("data-card-video");
    await cover.click();
    await expect(page).toHaveURL(`/video/${id}`);
    await expect(page.locator("video")).toHaveCount(1);
    expect(await page.evaluate(() => (window as unknown as { calls: number }).calls)).toBe(0);
    await page.goBack();
    await expect(page.locator("main [data-card-video]").first()).toBeVisible();
    expect(errors).toEqual([]);
    await context.close();
  }
});

// The cover must start where the card is, and land where the player
// stays: read from the browser's own keyframes of the moving box.
for (const hover of [false, true]) {
  test(`the cover flies from its card to the player's final place (${hover ? "with" : "without"} the mouse on it)`, async ({
    page,
    isMobile,
  }) => {
    test.skip(hover && isMobile, "a phone has no mouse");
    const errors = watchErrors(page);
    await logIn(page, PEOPLE[0]);
    await page.goto("/");
    await page.evaluate(() => {
      const w = window as unknown as { keys: unknown };
      const real = document.startViewTransition.bind(document);
      document.startViewTransition = ((update: () => Promise<void>) => {
        const t = real(update);
        t.ready
          .then(() => {
            const group = document
              .getAnimations()
              .find(
                (a) =>
                  (a.effect as KeyframeEffect).pseudoElement ===
                  "::view-transition-group(video-player)",
              );
            const k = (group?.effect as KeyframeEffect | undefined)?.getKeyframes() ?? [];
            w.keys = k.map((f) => ({
              m: String(f.transform),
              w: Number.parseFloat(String(f.width)),
              h: Number.parseFloat(String(f.height)),
            }));
          })
          .catch(() => {});
        return t;
      }) as typeof document.startViewTransition;
    });
    const cover = page.locator("main [data-card-video]").nth(1);
    await cover.scrollIntoViewIfNeeded();
    if (hover) {
      await cover.hover();
      await page.waitForTimeout(1000);
    }
    const card = await cover.boundingBox();
    await cover.click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { keys?: unknown }).keys))
      .toBeTruthy();
    await page.waitForTimeout(1000);
    const frame = await page.locator("[data-video-frame]").boundingBox();
    const keys = (await page.evaluate(
      () => (window as unknown as { keys: { m: string; w: number; h: number }[] }).keys,
    )) as { m: string; w: number; h: number }[];
    const at = (m: string) =>
      m
        .match(/-?[\d.]+/g)
        ?.slice(4, 6)
        .map(Number) ?? [];
    const [x0, y0] = at(keys[0].m);
    const [x1, y1] = at(keys[keys.length - 1].m);
    expect(Math.abs(x0 - (card?.x ?? 0))).toBeLessThan(4);
    expect(Math.abs(y0 - (card?.y ?? 0))).toBeLessThan(4);
    expect(Math.abs(keys[0].w - (card?.width ?? 0))).toBeLessThan(4);
    expect(Math.abs(x1 - (frame?.x ?? 0))).toBeLessThan(4);
    expect(Math.abs(y1 - (frame?.y ?? 0))).toBeLessThan(4);
    expect(Math.abs(keys[keys.length - 1].w - (frame?.width ?? 0))).toBeLessThan(4);
    expect(errors).toEqual([]);
  });
}

// watchMorph notes, from inside the page, how the next view transition
// went: how long the cover's move lasts, and whether the browser skipped
// it (finished rejected) or the page gave it up (skipTransition).
async function watchMorph(page: Page) {
  await page.evaluate(() => {
    const m = { calls: 0, duration: -1, skipped: false, rejected: false, done: false };
    (window as unknown as { morph: typeof m }).morph = m;
    const real = document.startViewTransition.bind(document);
    document.startViewTransition = ((update: () => Promise<void>) => {
      m.calls++;
      const t = real(update);
      const skip = t.skipTransition.bind(t);
      t.skipTransition = () => {
        m.skipped = true;
        skip();
      };
      t.ready
        .then(() => {
          const group = document
            .getAnimations()
            .find(
              (a) =>
                (a.effect as KeyframeEffect).pseudoElement ===
                "::view-transition-group(video-player)",
            );
          m.duration = Number(group?.effect?.getTiming().duration ?? -1);
        })
        .catch(() => {
          m.rejected = true;
        });
      t.finished.then(
        () => {
          m.done = true;
        },
        () => {
          m.rejected = true;
          m.done = true;
        },
      );
      return t;
    }) as typeof document.startViewTransition;
  });
}

type Morph = {
  calls: number;
  duration: number;
  skipped: boolean;
  rejected: boolean;
  done: boolean;
};

async function morphResult(page: Page): Promise<Morph> {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { morph: Morph }).morph.done))
    .toBe(true);
  return page.evaluate(() => (window as unknown as { morph: Morph }).morph);
}

test("the cover moves as long from the home page as from the videos beside the player", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await logIn(page, PEOPLE[0]);
  await page.goto("/");
  const card = page.locator("main [data-card-video]").first();
  await card.hover();
  await page.waitForTimeout(500);
  await watchMorph(page);
  await card.click();
  const home = await morphResult(page);

  const side = page.locator("[data-video-frame] ~ * [data-card-video]").first();
  await expect(side).toBeVisible();
  await page.waitForTimeout(500);
  await watchMorph(page);
  await side.click();
  const beside = await morphResult(page);

  for (const m of [home, beside]) {
    expect(m.calls).toBe(1);
    expect(m.skipped).toBe(false);
    expect(m.rejected).toBe(false);
    expect(m.duration).toBeGreaterThan(400);
  }
  expect(Math.abs(home.duration - beside.duration)).toBeLessThanOrEqual(20);
  expect(errors).toEqual([]);
});

test("on the first click, before the player's code arrived, the page opens plainly", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await logIn(page, PEOPLE[0]);
  // A slow connection: the player's code takes a while.
  await page.route(/\/assets\/(VideoPage|Player)-.*\.js$/, async (route) => {
    await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await page.goto("/");
  const card = page.locator("main [data-card-video]").first();
  await expect(card).toBeVisible();
  await watchMorph(page);
  const id = await card.getAttribute("data-card-video");
  await card.click();
  await expect(page).toHaveURL(`/video/${id}`);
  await expect(page.locator(`[data-video-frame="${id}"]`)).toBeVisible();
  const m = await page.evaluate(() => (window as unknown as { morph: Morph }).morph);
  // No half animation (a fade without the cover): no transition at all.
  expect(m.calls).toBe(0);
  expect(errors).toEqual([]);
});
