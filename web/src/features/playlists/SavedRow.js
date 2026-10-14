import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { fetchPlaylist, fetchPlaylists } from "../../api/playlists";
import { VideoCard } from "../videos/VideoCard";
import { VideoRow } from "../videos/VideoRow";
// rowSize is how many videos the row shows; the list has all of them.
const rowSize = 12;
// SavedRow shows on the Home the videos in my "Guarda più tardi". With
// none it shows nothing.
export function SavedRow({ fold }) {
    const [now] = useState(() => new Date());
    const [saved, setSaved] = useState(null);
    useEffect(() => {
        const controller = new AbortController();
        loadSaved(controller.signal)
            .then(setSaved)
            .catch((error) => {
            // Without it the Home still works: the row simply does not appear.
            if (!controller.signal.aborted)
                console.error(error);
        });
        return () => controller.abort();
    }, []);
    if (!saved || saved.videos.length === 0)
        return null;
    return (_jsx(VideoRow, { title: "I tuoi salvati", icon: "save", fold: fold, more: `/playlist/${saved.list}`, children: saved.videos.map((video) => (_jsx("li", { children: _jsx(VideoCard, { video: video, now: now }) }, video.id))) }));
}
async function loadSaved(signal) {
    const later = (await fetchPlaylists(undefined, signal)).find((p) => p.kind === "later");
    if (!later || later.videos === 0)
        return null;
    const page = await fetchPlaylist(later.id, signal);
    return { list: later.id, videos: page.videos.slice(0, rowSize) };
}
