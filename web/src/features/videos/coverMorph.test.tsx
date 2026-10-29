import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { parseVideo } from "../../api/videos";
import { videoJSON } from "../../test/fixtures";
import { forgetForTests, openVideo, plainClick } from "./coverMorph";
import { VideoCard } from "./VideoCard";

vi.mock("../../app/lazyPages", () => ({
  VideoPage: { preload: () => Promise.resolve() },
}));

const now = new Date("2026-10-12T08:00:00Z");

function show() {
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<VideoCard video={parseVideo(videoJSON())} now={now} />} />
        <Route path="/video/:id" element={<p>Pagina del video</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByRole("link", { name: /Mare 2024/ });
}

// fakeTransition stands in for the browser's view transitions: it runs
// the change at once, like a browser that skips the animation.
function fakeTransition() {
  const start = vi.fn((update: () => Promise<void>) => {
    const done = Promise.resolve(update());
    return {
      ready: Promise.resolve(),
      updateCallbackDone: done,
      finished: done,
      skipTransition() {},
    };
  });
  Object.assign(document, { startViewTransition: start });
  return start;
}

afterEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: jsdom has no view transitions.
  delete (document as any).startViewTransition;
  delete document.documentElement.dataset.morph;
  vi.unstubAllGlobals();
  forgetForTests();
});

describe("opening a video from its card", () => {
  it("is a plain link where the browser has no view transitions", () => {
    const link = show();
    fireEvent.click(link);
    expect(screen.getByText("Pagina del video")).toBeInTheDocument();
  });

  it("grows the cover into the player where the browser can", async () => {
    vi.stubGlobal("navigator", { ...navigator, hardwareConcurrency: 8 });
    const start = fakeTransition();
    const link = show();
    fireEvent.click(link);
    await act(async () => {
      await new Promise((done) => setTimeout(done, 200));
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Pagina del video")).toBeInTheDocument();
    // Nothing keeps the shared name once it is over.
    expect(document.querySelector("[style*=view-transition-name]")).toBeNull();
  });

  it("leaves Ctrl, Cmd and the middle button to the browser", () => {
    vi.stubGlobal("navigator", { ...navigator, hardwareConcurrency: 8 });
    const start = fakeTransition();
    const link = show();
    fireEvent.click(link, { ctrlKey: true });
    fireEvent.click(link, { metaKey: true });
    expect(start).not.toHaveBeenCalled();
  });

  it("stays plain on a weak device", () => {
    vi.stubGlobal("navigator", { ...navigator, hardwareConcurrency: 2 });
    const start = fakeTransition();
    const link = show();
    fireEvent.click(link);
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByText("Pagina del video")).toBeInTheDocument();
  });
});

describe("a click elsewhere while the player's code arrives", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("wins over the video clicked before", async () => {
    fakeTransition();
    const cover = document.createElement("div");
    document.body.append(cover);
    const go = vi.fn();
    let arrive = () => {};
    const code = new Promise<void>((resolve) => {
      arrive = resolve;
    });

    const opening = openVideo(cover, 7, go, () => code);
    // The person taps "Categorie" before the player's code is there.
    window.history.pushState(null, "", "/categorie");
    arrive();
    await opening;

    expect(go).not.toHaveBeenCalled();
    cover.remove();
  });
});

describe("plainClick", () => {
  const click = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
  };
  it.each([
    ["left button", click, true],
    ["middle button", { ...click, button: 1 }, false],
    ["ctrl", { ...click, ctrlKey: true }, false],
    ["cmd", { ...click, metaKey: true }, false],
    ["shift", { ...click, shiftKey: true }, false],
    ["already handled", { ...click, defaultPrevented: true }, false],
  ])("%s", (_, event, want) => {
    expect(plainClick(event)).toBe(want);
  });
});
