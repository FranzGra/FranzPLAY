import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { defaultLook, fetchLook, type Look } from "../api/site";

type SiteContextValue = {
  look: Look;
  ready: boolean; // the server answered (or could not): look is final
  // changed shows a new look at once, after the administrator saved it.
  changed: (look: Look) => void;
};

const SiteContext = createContext<SiteContextValue>({
  look: defaultLook,
  ready: true,
  changed: () => {},
});

// SiteProvider asks the server the name and color of the site when the
// page opens, even before logging in.
// Until the server answers, or if it does not, FranzPLAY's own look is shown.
export function SiteProvider({ children }: { children: ReactNode }) {
  const [look, setLook] = useState<Look>(defaultLook);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchLook(controller.signal)
      .then(setLook)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.error(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setReady(true);
      });
    return () => controller.abort();
  }, []);

  // The site's color is "FranzPLAY's own" for the color picker of the
  // profile; app/auth.tsx paints the page with it, or with the person's.
  useEffect(() => {
    document.documentElement.style.setProperty("--color-accent-own", look.color);
  }, [look.color]);

  return (
    <SiteContext.Provider value={{ look, ready, changed: setLook }}>
      {children}
    </SiteContext.Provider>
  );
}

export function useSite(): SiteContextValue {
  return useContext(SiteContext);
}
