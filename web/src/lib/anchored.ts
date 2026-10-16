import { type CSSProperties, type RefObject, useCallback, useLayoutEffect, useState } from "react";

// gap is the space between the button and the panel, in pixels.
const gap = 8;
// margin keeps the panel this far from the window's edges.
const margin = 8;

// Place is where a panel sits in the window, measured from its button.
// fromRight says the panel ends at the button's right edge, so it grows
// from that corner.
export type Place = { left: number; width: number; maxHeight: number; fromRight: boolean } & (
  | { top: number }
  | { bottom: number }
);

// useAnchored measures where a panel that hangs from a button goes, while
// open is true: under the button when roomWanted pixels fit there (or
// when there is more room under than above), otherwise above it. The
// panel takes width pixels, or the window's width if that is less. It
// starts at the button's left edge; when that would cross the window's
// right edge it ends at the button's right edge instead, so a button on
// the right opens its panel towards the middle. The place follows the
// page as it scrolls and the window as it changes size.
export function useAnchored(
  button: RefObject<HTMLElement | null>,
  open: boolean,
  width: number,
  roomWanted: number,
): Place | null {
  const [place, setPlace] = useState<Place | null>(null);

  const measure = useCallback(() => {
    const box = button.current?.getBoundingClientRect();
    if (!box) return;
    const w = Math.min(width, window.innerWidth - 2 * margin);
    const fromRight = box.left + w > window.innerWidth - margin;
    const start = fromRight ? box.right - w : box.left;
    const left = Math.max(margin, Math.min(start, window.innerWidth - w - margin));
    const below = window.innerHeight - box.bottom - gap - margin;
    const above = box.top - gap - margin;
    setPlace(
      below >= roomWanted || below >= above
        ? { left, width: w, fromRight, top: box.bottom + gap, maxHeight: below }
        : {
            left,
            width: w,
            fromRight,
            bottom: window.innerHeight - box.top + gap,
            maxHeight: above,
          },
    );
  }, [button, width, roomWanted]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, measure]);

  return place;
}

// placeStyle turns a place into the panel's style.
export function placeStyle(place: Place): CSSProperties {
  return {
    left: place.left,
    width: place.width,
    maxHeight: place.maxHeight,
    ...("top" in place ? { top: place.top } : { bottom: place.bottom }),
  };
}
