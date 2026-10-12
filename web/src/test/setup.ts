import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// jsdom has no real video: play() only says "not implemented" and returns
// nothing, while every browser returns a promise. Tests that need it to
// play replace it with their own stand-in.
HTMLMediaElement.prototype.play = () => Promise.resolve();

// The site's color is painted on the whole page: each test starts clean.
afterEach(() => document.documentElement.removeAttribute("style"));
