import { expect, test } from "@playwright/test";
import { logIn, PEOPLE, videos, watchErrors } from "./franzplay";

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
