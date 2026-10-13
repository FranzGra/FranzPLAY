import { defineConfig, devices } from "@playwright/test";

// The browser checks of FranzPLAY: the real program, with a few real
// videos, opened by a real browser, as on a computer and on a phone.
// global-setup.ts starts FranzPLAY; global-teardown.ts stops it.
export default defineConfig({
  testDir: "tests",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  // One at a time, like a small home computer serving a family.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:8091",
    colorScheme: "dark",
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "computer",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "telefono",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
