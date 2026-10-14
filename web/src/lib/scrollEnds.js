import { useCallback, useEffect, useState } from "react";
// useScrollEnds says whether the row can still scroll left and right, and
// keeps the answer up to date while it scrolls or changes size.
export function useScrollEnds(list, open) {
    const [ends, setEnds] = useState({ left: false, right: false });
    const update = useCallback(() => {
        const el = list.current;
        if (!el) {
            return;
        }
        // A pixel of slack: zoomed pages scroll by fractions.
        const left = el.scrollLeft > 1;
        const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
        setEnds((old) => (old.left === left && old.right === right ? old : { left, right }));
    }, [list]);
    useEffect(() => {
        const el = list.current;
        if (!open || !el) {
            return;
        }
        update();
        el.addEventListener("scroll", update, { passive: true });
        // Cards arriving later, or a wider window, change what fits.
        const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
        watch?.observe(el);
        for (const child of el.children) {
            watch?.observe(child);
        }
        return () => {
            el.removeEventListener("scroll", update);
            watch?.disconnect();
        };
    }, [list, open, update]);
    return ends;
}
