import { useEffect } from "react";
import { siteName } from "../api/site";
import { useSite } from "../app/site";
// usePageTitle sets the browser tab title, e.g. "Playlist · FranzPLAY",
// with the name the administrator gave the site.
export function usePageTitle(title) {
    const name = siteName(useSite().look);
    useEffect(() => {
        document.title = title ? `${title} · ${name}` : name;
    }, [title, name]);
}
