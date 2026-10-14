import { createContext, useContext, useLayoutEffect } from "react";
// PageWidthContext carries the frame's setter to the pages inside it.
// Outside the frame (in tests of a single page) asking does nothing.
export const PageWidthContext = createContext(() => { });
// usePageWidth asks the frame for room while the page is open, and gives
// it back when the page closes. It asks before the browser draws, so the
// frame changes in the same picture as the page (theater mode glides
// smoothly only if both change together).
export function usePageWidth(width) {
    const setWidth = useContext(PageWidthContext);
    useLayoutEffect(() => {
        setWidth(width);
        return () => setWidth("normal");
    }, [width, setWidth]);
}
