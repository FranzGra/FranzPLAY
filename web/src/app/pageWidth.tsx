import { createContext, useContext, useLayoutEffect } from "react";

// PageWidth is how much room a page takes in the frame:
// "normal" a centered column, like most pages;
// "wide"   all the room next to the side menu, for the video page;
// "full"   the whole width, without the side menu: theater mode.
// On phones every page is the same: the whole screen.
export type PageWidth = "normal" | "wide" | "full";

// PageWidthContext carries the frame's setter to the pages inside it.
// Outside the frame (in tests of a single page) asking does nothing.
export const PageWidthContext = createContext<(width: PageWidth) => void>(() => {});

// usePageWidth asks the frame for room while the page is open, and gives
// it back when the page closes. It asks before the browser draws, so the
// frame changes in the same picture as the page (theater mode glides
// smoothly only if both change together).
export function usePageWidth(width: PageWidth) {
  const setWidth = useContext(PageWidthContext);
  useLayoutEffect(() => {
    setWidth(width);
    return () => setWidth("normal");
  }, [width, setWidth]);
}
