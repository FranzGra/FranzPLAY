import { morph, removeAllSmoothly, removeSmoothly, slideIntoPlace } from "./motion";

type Call = { element: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions };

// fakeAnimations stands in for the browser's animations, which jsdom
// lacks, and records every move asked for.
function fakeAnimations() {
  const calls: Call[] = [];
  const reversed: Element[] = [];
  const animate = function (
    this: Element,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ) {
    calls.push({ element: this, keyframes, options });
    return {
      finished: Promise.resolve(),
      reverse: () => reversed.push(this),
    } as unknown as Animation;
  };
  Object.defineProperty(Element.prototype, "animate", { value: animate, configurable: true });
  return { calls, reversed };
}

// place puts an element at y on the page, as far as measuring goes.
function place(element: Element, y: () => number) {
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(
    () => ({ left: 0, top: y(), width: 100, height: 50 }) as DOMRect,
  );
}

afterEach(() => {
  document.body.innerHTML = "";
  // biome-ignore lint/suspicious/noExplicitAny: jsdom has no animations; the stand-in goes away
  delete (Element.prototype as any).animate;
});

describe("removeSmoothly", () => {
  it("drops the item once the server agreed", async () => {
    const item = document.createElement("li");
    const drop = vi.fn();
    await removeSmoothly(item, () => Promise.resolve(), drop);
    expect(drop).toHaveBeenCalledOnce();
    expect(item.inert).toBe(true);
  });

  it("keeps the item, and lets it be pressed again, when the server refuses", async () => {
    const { reversed } = fakeAnimations();
    const item = document.createElement("li");
    document.body.append(item);
    const drop = vi.fn();
    await expect(removeSmoothly(item, () => Promise.reject(new Error("no")), drop)).rejects.toThrow(
      "no",
    );
    expect(drop).not.toHaveBeenCalled();
    expect(item.inert).toBe(false);
    expect(reversed).toEqual([item]);
  });

  it("fades the item away and keeps its last frame", async () => {
    const { calls } = fakeAnimations();
    const item = document.createElement("li");
    document.body.append(item);
    await removeSmoothly(
      item,
      () => Promise.resolve(),
      () => item.remove(),
    );
    expect(calls[0]?.element).toBe(item);
    expect(calls[0]?.keyframes.at(-1)).toMatchObject({ opacity: 0 });
    expect(calls[0]?.options.fill).toBe("forwards");
  });

  it("does not move anything for whoever asked for less motion", async () => {
    const { calls } = fakeAnimations();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    const item = document.createElement("li");
    document.body.append(item);
    await removeSmoothly(
      item,
      () => Promise.resolve(),
      () => item.remove(),
    );
    expect(calls).toEqual([]);
  });
});

describe("removeAllSmoothly", () => {
  it("lets the items leave one after the other, then empties the list", async () => {
    const { calls } = fakeAnimations();
    const items = [1, 2, 3].map(() => document.body.appendChild(document.createElement("li")));
    const drop = vi.fn();
    await removeAllSmoothly(items, () => Promise.resolve(), drop);
    expect(calls.map((c) => c.options.delay)).toEqual([0, 30, 60]);
    expect(drop).toHaveBeenCalledOnce();
  });
});

describe("slideIntoPlace", () => {
  it("glides what moved from where it was", () => {
    const { calls } = fakeAnimations();
    const gone = document.createElement("li");
    const below = document.createElement("li");
    const still = document.createElement("li");
    for (const li of [still, gone, below]) {
      li.dataset.flip = "";
      document.body.append(li);
    }
    let removed = false;
    place(still, () => 0);
    place(gone, () => 60);
    place(below, () => (removed ? 60 : 120));

    slideIntoPlace(() => {
      gone.remove();
      removed = true;
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.element).toBe(below);
    expect(calls[0]?.keyframes).toEqual([{ translate: "0px 60px" }, { translate: "0 0" }]);
  });

  it("does not move twice what sits inside something moving", () => {
    const { calls } = fakeAnimations();
    const outer = document.createElement("li");
    const inner = document.createElement("li");
    outer.dataset.flip = "";
    inner.dataset.flip = "";
    outer.append(inner);
    document.body.append(outer);
    let changed = false;
    place(outer, () => (changed ? 0 : 60));
    place(inner, () => (changed ? 20 : 80));

    slideIntoPlace(() => {
      changed = true;
    });

    expect(calls.map((c) => c.element)).toEqual([outer]);
  });
});

describe("morph", () => {
  // fakeViewTransitions stands in for the browser's view transitions,
  // which jsdom lacks, and runs the change the way the browser would.
  function fakeViewTransitions() {
    const start = vi.fn((update: () => void) => {
      update();
      return {} as ViewTransition;
    });
    Object.defineProperty(document, "startViewTransition", { value: start, configurable: true });
    return start;
  }

  afterEach(() => {
    // biome-ignore lint/suspicious/noExplicitAny: the stand-in goes away
    delete (document as any).startViewTransition;
    vi.unstubAllGlobals();
  });

  it("makes the change at once where the browser cannot glide", () => {
    const change = vi.fn();
    morph(change);
    expect(change).toHaveBeenCalledOnce();
  });

  it("lets the browser glide to the change", () => {
    const start = fakeViewTransitions();
    const change = vi.fn();
    morph(change);
    expect(start).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledOnce();
  });

  it("makes the change at once for whoever asked for less motion", () => {
    const start = fakeViewTransitions();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    const change = vi.fn();
    morph(change);
    expect(start).not.toHaveBeenCalled();
    expect(change).toHaveBeenCalledOnce();
  });
});
