import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";

// Pages load their code a piece at a time (React.lazy): on a busy
// computer the default second is not always enough to find them.
configure({ asyncUtilTimeout: 4000 });

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

// Settings remembered by the browser do not pass from one test to the next.
afterEach(() => window.localStorage.clear());

// jsdom does not scroll: scrollTo only says "not implemented". Pages that
// open at their top (Layout) call it on every new address.
window.scrollTo = () => {};
