import { flushSync } from "react-dom";
// Moves that CSS alone cannot do, because they depend on where things were
// before React changed the page. They use the browser's own animations and
// move only opacity and position, so even a Raspberry Pi's browser keeps up.
// Whoever asked their device for less motion gets every change at once.
// lessMotion says whether the person asked their device for less motion.
export function lessMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
function canAnimate(element) {
    return element instanceof HTMLElement && typeof element.animate === "function" && !lessMotion();
}
// The same curve as --ease-out in styles/global.css.
const easeOut = "cubic-bezier(0.22, 1, 0.36, 1)";
// leave makes an item fade and shrink away, after delay milliseconds. It
// keeps its last frame until the page takes it away. It returns the move,
// or null when nothing moves.
export function leave(item, delay = 0) {
    if (!canAnimate(item))
        return null;
    return item.animate([
        { opacity: 1, scale: "1" },
        { opacity: 0, scale: "0.94" },
    ], { duration: 200, delay, easing: "ease-in", fill: "forwards" });
}
// slideIntoPlace runs change, which takes something off the page, and lets
// the elements marked with data-flip glide from where they were to where
// they end up, instead of jumping there. (The trick is called FLIP: First,
// Last, Invert, Play.)
export function slideIntoPlace(change) {
    if (!canAnimate(document.body)) {
        change();
        return;
    }
    const before = new Map();
    for (const element of document.querySelectorAll("[data-flip]")) {
        before.set(element, element.getBoundingClientRect());
    }
    // Draw the change now, so the new places can be measured right away.
    flushSync(change);
    const after = new Map();
    for (const element of before.keys()) {
        if (element.isConnected)
            after.set(element, element.getBoundingClientRect());
    }
    for (const [element, now] of after) {
        const was = before.get(element);
        if (!was || !(element instanceof HTMLElement))
            continue;
        let dx = was.left - now.left;
        let dy = was.top - now.top;
        // Something inside a moving element already moves with it.
        const parent = element.parentElement?.closest("[data-flip]");
        const parentWas = parent && before.get(parent);
        const parentNow = parent && after.get(parent);
        if (parentWas && parentNow) {
            dx -= parentWas.left - parentNow.left;
            dy -= parentWas.top - parentNow.top;
        }
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1)
            continue;
        element.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], {
            duration: 360,
            easing: easeOut,
        });
    }
}
// removeSmoothly takes an item off a list: the item fades away while save
// runs (usually the server), then drop takes it off the page and the
// others glide into its place. If save fails, the item comes back and the
// error goes on to the caller. While it leaves, the item cannot be pressed
// again.
export async function removeSmoothly(item, save, drop) {
    setInert(item, true);
    const out = leave(item);
    try {
        await Promise.all([save(), out?.finished]);
    }
    catch (error) {
        out?.reverse();
        setInert(item, false);
        throw error;
    }
    slideIntoPlace(drop);
}
// removeAllSmoothly is removeSmoothly for many items at once: they leave
// one after the other, quickly, then drop empties the list.
export async function removeAllSmoothly(items, save, drop) {
    const list = [...items];
    for (const item of list)
        setInert(item, true);
    // Only the first few wait their turn, so a long list never feels slow.
    const outs = list.map((item, i) => leave(item, Math.min(i, 8) * 30));
    try {
        await Promise.all([save(), ...outs.map((out) => out?.finished)]);
    }
    catch (error) {
        for (const out of outs)
            out?.reverse();
        for (const item of list)
            setInert(item, false);
        throw error;
    }
    drop();
}
function setInert(item, inert) {
    if (item instanceof HTMLElement)
        item.inert = inert;
}
// morph runs change, which rearranges the page, and lets the browser glide
// from the old look to the new one instead of jumping: whatever has a
// view-transition-name in the CSS grows, shrinks and moves to its new
// place, and the rest fades across. The browser does it with pictures of
// the page, so nothing is laid out again while it moves. Browsers without
// it, and whoever asked for less motion, get the change at once.
export function morph(change) {
    if (typeof document.startViewTransition !== "function" || lessMotion()) {
        change();
        return;
    }
    // The browser takes its picture of the new page when this returns, so
    // React must draw the change right away.
    document.startViewTransition(() => flushSync(change));
}
