import { type CSSProperties, createContext, useContext, useEffect, useState } from "react";
import type { HomeLook, HomeSections } from "../../api/home";

// cardWidths are the smallest widths of a card, in pixels, from size 1
// (small) to 5 (big). Size 3 is the Home as it always was.
const cardWidths = [180, 220, 260, 320, 400] as const;

// gap is the space between two cards in a line, as in the CSS.
const gap = 20;

// cardWidth is the smallest width of a card of the given size.
export function cardWidth(size: number): number {
  return cardWidths[Math.min(Math.max(Math.round(size), 1), 5) - 1] ?? cardWidths[2];
}

// lookStyle turns the look into the CSS variables the grids and the rows
// of the Home read. They count only on a computer or tablet: on a phone
// the CSS keeps big cards, one under the other.
export function lookStyle(look: HomeLook): CSSProperties {
  if (look.columns === 0) {
    const width = cardWidth(look.size);
    return {
      "--home-grid": `repeat(auto-fill, minmax(${width}px, 1fr))`,
      "--home-card": `${width}px`,
    } as CSSProperties;
  }
  const n = look.columns;
  return {
    "--home-grid": `repeat(${n}, minmax(0, 1fr))`,
    "--home-card": `calc((100% - ${(n - 1) * gap}px) / ${n})`,
  } as CSSProperties;
}

// SectionsContext says to the rows of the Home how much of each to show.
// Outside the Home a row is a line that scrolls sideways.
export const SectionsContext = createContext<HomeSections>("scroll");

// wideQuery is a tablet or a computer: where the look can be chosen.
export const wideQuery = "(min-width: 600px)";

// useWide says whether the screen is a tablet or a computer, and follows
// it when the window changes size. Without matchMedia it says yes.
export function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia?.(wideQuery).matches ?? true);
  useEffect(() => {
    const media = window.matchMedia?.(wideQuery);
    if (!media) return;
    const update = () => setWide(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return wide;
}

// useSections is how much each row of the Home shows: on a phone, always
// a line that scrolls sideways with big cards.
export function useSections(): HomeSections {
  const sections = useContext(SectionsContext);
  return useWide() ? sections : "scroll";
}
