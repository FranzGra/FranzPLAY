import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { fetchVideos } from "../../api/videos";
import { VideoCard } from "./VideoCard";
import { VideoRow } from "./VideoRow";
// rowSize is how many of the newest videos the row shows.
const rowSize = 12;
// LatestRow shows on the Home the videos arrived last, since the list
// below them is in a mixed order. With no videos it shows nothing.
export function LatestRow({ fold }) {
    const [now] = useState(() => new Date());
    const [videos, setVideos] = useState([]);
    useEffect(() => {
        const controller = new AbortController();
        fetchVideos({ limit: rowSize }, controller.signal)
            .then((list) => setVideos(list.videos))
            .catch((error) => {
            // Without it the Home still works: the row simply does not appear.
            if (!controller.signal.aborted)
                console.error(error);
        });
        return () => controller.abort();
    }, []);
    if (videos.length === 0)
        return null;
    return (_jsx(VideoRow, { title: "Ultimi arrivati", icon: "clock", fold: fold, children: videos.map((video) => (_jsx("li", { children: _jsx(VideoCard, { video: video, now: now }) }, video.id))) }));
}
