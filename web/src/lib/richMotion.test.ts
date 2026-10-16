import { canMorphPages, isRich, richMotion } from "./richMotion";

const strong = { reducedMotion: false, saveData: false, cores: 8, memory: 8 };

describe("isRich", () => {
  it.each([
    ["a strong computer", strong, true],
    [
      "the browser does not say how strong (Safari, Firefox)",
      { ...strong, cores: undefined, memory: undefined },
      true,
    ],
    ["less motion asked", { ...strong, reducedMotion: true }, false],
    ["less data asked", { ...strong, saveData: true }, false],
    ["two cores", { ...strong, cores: 2 }, false],
    ["one core", { ...strong, cores: 1 }, false],
    ["four cores", { ...strong, cores: 4 }, true],
    ["2 GB of memory", { ...strong, memory: 2 }, false],
    ["half a gigabyte", { ...strong, memory: 0.5 }, false],
    ["4 GB of memory", { ...strong, memory: 4 }, true],
    ["zero cores means not known", { ...strong, cores: 0 }, true],
  ])("%s", (_, device, want) => {
    expect(isRich(device)).toBe(want);
  });
});

describe("richMotion and canMorphPages in the browser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // biome-ignore lint/suspicious/noExplicitAny: the test removes what jsdom lacks anyway.
    delete (document as any).startViewTransition;
  });

  it("follows prefers-reduced-motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    expect(richMotion()).toBe(false);
  });

  it("follows the data saver", () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      connection: { saveData: true },
      hardwareConcurrency: 8,
    });
    expect(richMotion()).toBe(false);
  });

  it("is off where the browser has no view transitions, without errors", () => {
    expect("startViewTransition" in document).toBe(false);
    expect(canMorphPages()).toBe(false);
  });

  it("is on where the browser has them, on a strong device", () => {
    vi.stubGlobal("navigator", { ...navigator, hardwareConcurrency: 8 });
    Object.assign(document, { startViewTransition: () => ({}) });
    expect(canMorphPages()).toBe(true);
  });
});
