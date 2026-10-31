import { type RefObject, useCallback, useLayoutEffect, useState } from "react";

// gap is the space between a field and its list, in pixels.
const gap = 6;
// tallest is the most a list grows before it scrolls.
const tallest = 320;

export type ListPlace = { left: number; width: number; maxHeight: number } & (
  | { top: number }
  | { bottom: number }
);

// useListPlace says where the open list of a field goes: under the field, or
// over it when there is more room above. The list lives at the end of the
// page (a portal), so no card can cut it.
export function useListPlace(
  anchor: RefObject<HTMLElement | null>,
  open: boolean,
): ListPlace | null {
  const [place, setPlace] = useState<ListPlace | null>(null);

  const measure = useCallback(() => {
    const field = anchor.current;
    if (!field) return;
    const box = field.getBoundingClientRect();
    const below = window.innerHeight - box.bottom - gap - 8;
    const above = box.top - gap - 8;
    const width = Math.max(box.width, 160);
    const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8));
    if (below >= Math.min(tallest, 200) || below >= above) {
      setPlace({ left, width, top: box.bottom + gap, maxHeight: Math.min(tallest, below) });
    } else {
      setPlace({
        left,
        width,
        bottom: window.innerHeight - box.top + gap,
        maxHeight: Math.min(tallest, above),
      });
    }
  }, [anchor]);

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
