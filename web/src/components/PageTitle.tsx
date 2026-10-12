import { useEffect } from "react";

// usePageTitle sets the browser tab title, e.g. "Playlist · FranzPLAY".
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · FranzPLAY` : "FranzPLAY";
  }, [title]);
}
