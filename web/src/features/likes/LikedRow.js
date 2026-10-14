import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { fetchLiked } from "../../api/likes";
import { VideoCard } from "../videos/VideoCard";
import { VideoRow } from "../videos/VideoRow";
// rowSize is how many videos the row shows; the page has all of them.
const rowSize = 12;
// LikedRow shows on the Home the last videos I liked. With none it shows
// nothing.
export function LikedRow({ fold }) {
    const [now] = useState(() => new Date());
    const [videos, setVideos] = useState([]);
    useEffect(() => {
        const controller = new AbortController();
        fetchLiked({ limit: rowSize }, controller.signal)
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
    return (_jsx(VideoRow, { title: "Ti piacciono", icon: "like", fold: fold, more: "/mi-piace", children: videos.map((video) => (_jsx("li", { children: _jsx(VideoCard, { video: video, now: now }) }, video.id))) }));
}
