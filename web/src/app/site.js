import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useEffect, useState } from "react";
import { defaultLook, fetchLook } from "../api/site";
const SiteContext = createContext({
    look: defaultLook,
    ready: true,
    changed: () => { },
});
// SiteProvider asks the server the name and color of the site when the
// page opens, even before logging in.
// Until the server answers, or if it does not, FranzPLAY's own look is shown.
export function SiteProvider({ children }) {
    const [look, setLook] = useState(defaultLook);
    const [ready, setReady] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        fetchLook(controller.signal)
            .then(setLook)
            .catch((error) => {
            if (!controller.signal.aborted)
                console.error(error);
        })
            .finally(() => {
            if (!controller.signal.aborted)
                setReady(true);
        });
        return () => controller.abort();
    }, []);
    // The site's color is "FranzPLAY's own" for the color picker of the
    // profile; app/auth.tsx paints the page with it, or with the person's.
    useEffect(() => {
        document.documentElement.style.setProperty("--color-accent-own", look.color);
    }, [look.color]);
    return (_jsx(SiteContext.Provider, { value: { look, ready, changed: setLook }, children: children }));
}
export function useSite() {
    return useContext(SiteContext);
}
