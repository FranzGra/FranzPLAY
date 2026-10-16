// Where each page of the history was scrolled to, so the back button
// brings the page back to the same place, like a page of a normal site.
// The browser cannot do it by itself here: the pages draw their lists a
// moment after the address changes, when its own try has passed.

// The router keeps a key for each entry of the history in history.state.
function keyOf(state: unknown): string {
  const key = (state as { key?: unknown } | null)?.key;
  return typeof key === "string" ? key : "default";
}

const places = new Map<string, number>();
// While the page goes back to a place, the scrolling it causes is not the
// person's, and is not remembered.
let restoring = 0;
let installed = false;

// installScrollMemory starts remembering. It runs once, before the router.
export function installScrollMemory(): void {
  if (installed) return;
  installed = true;
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  window.addEventListener(
    "scroll",
    () => {
      if (restoring === 0) places.set(keyOf(history.state), window.scrollY);
    },
    { passive: true },
  );
  // A new entry: the page left was remembered by the scroll listener.
  window.addEventListener("popstate", () => {
    restoring++;
    // Let the next restorePlace take over; never stay stuck.
    window.setTimeout(() => {
      restoring = Math.max(0, restoring - 1);
    }, 1000);
  });
}

// scrollToSaved jumps once to where the current entry was left, as far as
// the page is already long enough.
export function scrollToSaved(): void {
  window.scrollTo(0, places.get(keyOf(history.state)) ?? 0);
}

// restorePlace scrolls to where the current entry was left. The page may
// still be growing as its lists arrive, so it tries again on the next
// frames, for up to a second, and stops as soon as the person scrolls.
export function restorePlace(): void {
  const want = places.get(keyOf(history.state)) ?? 0;
  window.scrollTo(0, want);
  restoring++;
  const end = performance.now() + 1000;
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  const opts = { passive: true, once: true } as const;
  window.addEventListener("wheel", stop, opts);
  window.addEventListener("touchstart", stop, opts);
  window.addEventListener("keydown", stop, opts);
  const step = () => {
    if (!stopped && Math.abs(window.scrollY - want) > 1 && performance.now() < end) {
      window.scrollTo(0, want);
      requestAnimationFrame(step);
      return;
    }
    restoring = Math.max(0, restoring - 1);
    window.removeEventListener("wheel", stop);
    window.removeEventListener("touchstart", stop);
    window.removeEventListener("keydown", stop);
  };
  requestAnimationFrame(step);
}
